// Music Hub Sync: sends every user's Navidrome play history to Music Hub,
// where it is combined with Plex plays for statistics and the yearly Rewind.
package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/navidrome/navidrome/plugins/pdk/go/host"
	"github.com/navidrome/navidrome/plugins/pdk/go/lifecycle"
	"github.com/navidrome/navidrome/plugins/pdk/go/pdk"
	"github.com/navidrome/navidrome/plugins/pdk/go/scheduler"
)

const (
	scheduleID = "musichub-sync"
	batchSize  = 500
	maxBatches = 20 // per user per run; a big backlog is worked off over several runs
)

type plugin struct{}

func init() {
	lifecycle.Register(&plugin{})
	scheduler.Register(&plugin{})
}

var (
	_ lifecycle.InitProvider     = (*plugin)(nil)
	_ scheduler.CallbackProvider = (*plugin)(nil)
)

type scrobble struct {
	ID string `json:"id"`
	TS int64  `json:"ts"`
}

type ingestBody struct {
	User      string     `json:"user"`
	Scrobbles []scrobble `json:"scrobbles"`
}

func cfg(key, def string) string {
	if v, ok := pdk.GetConfig(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func (p *plugin) OnInit() error {
	every := cfg("intervalMinutes", "1")
	if n, err := strconv.Atoi(every); err != nil || n < 1 || n > 59 {
		every = "1"
	}
	if _, err := host.SchedulerScheduleRecurring(fmt.Sprintf("*/%s * * * *", every), "", scheduleID); err != nil {
		pdk.Log(pdk.LogError, "musichub: could not schedule sync: "+err.Error())
		return err
	}
	// first sync shortly after start
	_, _ = host.SchedulerScheduleOneTime(15, "", scheduleID+"-boot")
	pdk.Log(pdk.LogInfo, "musichub: sync every "+every+" min to "+cfg("hubUrl", "http://musichub:8095"))
	return nil
}

func (p *plugin) OnCallback(req scheduler.SchedulerCallbackRequest) error {
	if err := runScans(); err != nil {
		pdk.Log(pdk.LogWarn, "musichub: scan queue: "+err.Error())
	}
	users, err := host.UsersGetUsers()
	if err != nil {
		return err
	}
	for _, u := range users {
		if err := syncUser(u.UserName); err != nil {
			pdk.Log(pdk.LogWarn, "musichub: sync for "+u.UserName+" failed: "+err.Error())
		}
	}
	return nil
}

func syncUser(user string) error {
	key := "last:" + user
	var from int64
	if b, ok, _ := host.KVStoreGet(key); ok {
		from, _ = strconv.ParseInt(string(b), 10, 64)
	}
	for i := 0; i < maxBatches; i++ {
		start := from + 1
		refs, _, err := host.ScrobbleRetrieverGetScrobbles(user, host.ScrobbleOptions{
			FromTimestamp: &start, MaxItems: batchSize, Descending: false,
		})
		if err != nil {
			return err
		}
		if len(refs) == 0 {
			return nil
		}
		body := ingestBody{User: user}
		newest := from
		for _, r := range refs {
			body.Scrobbles = append(body.Scrobbles, scrobble{ID: r.MediaFileID, TS: r.SubmissionTime})
			if r.SubmissionTime > newest {
				newest = r.SubmissionTime
			}
		}
		if err := post(body); err != nil {
			return err // keep the old marker, the hub de-duplicates on retry
		}
		from = newest
		if err := host.KVStoreSet(key, []byte(strconv.FormatInt(from, 10))); err != nil {
			return err
		}
		if len(refs) < batchSize {
			return nil
		}
	}
	return nil
}

// runScans starts a targeted Navidrome scan for every folder Music Hub downloaded into.
// Scans need admin rights, which this plugin has through an admin user assigned to it.
func runScans() error {
	resp, err := hubPost("/api/plugin/scan-queue", nil)
	if err != nil {
		return err
	}
	var q struct {
		Targets []string `json:"targets"`
	}
	if err := json.Unmarshal(resp, &q); err != nil || len(q.Targets) == 0 {
		return err
	}
	admins, err := host.UsersGetAdmins()
	if err != nil || len(admins) == 0 {
		return fmt.Errorf("no admin user assigned to the plugin, cannot scan %v", q.Targets)
	}
	uri := "startScan?u=" + url.QueryEscape(admins[0].UserName)
	for _, t := range q.Targets {
		uri += "&target=" + url.QueryEscape(t)
	}
	if _, err := host.SubsonicAPICall(uri); err != nil {
		return err
	}
	pdk.Log(pdk.LogInfo, fmt.Sprintf("musichub: scanning %d new folder(s)", len(q.Targets)))
	return nil
}

func post(body ingestBody) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	_, err = hubPost("/api/ingest/navidrome", payload)
	return err
}

func hubPost(path string, payload []byte) ([]byte, error) {
	target := strings.TrimRight(cfg("hubUrl", "http://musichub:8095"), "/") + path
	resp, err := host.HTTPSend(host.HTTPRequest{
		Method: "POST", URL: target, Body: payload, TimeoutMs: 20000,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Authorization": "Bearer " + cfg("secret", ""),
		},
	})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("hub answered %d: %s", resp.StatusCode, string(resp.Body))
	}
	return resp.Body, nil
}

func main() {}
