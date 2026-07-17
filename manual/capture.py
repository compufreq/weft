"""Native-Chrome screenshot storyboard for the Weft user manual.

Talks CDP to a headless Chromium (remote debugging on chrome:9222), forces
prefers-color-scheme: light, arranges each UI state with an injected JS
snippet, and saves real renderer screenshots. Phases:
  phase1    - the 15 normal-mode states
  authgate  - the token prompt (backend must run with WEFT_AUTH_TOKEN)
  readonly  - the read-only banner (backend must run with WEFT_READ_ONLY)
"""
import base64
import json
import os
import sys
import time
import urllib.request

import websocket  # websocket-client

CHROME = os.environ.get("CHROME_CDP", "http://chrome:3000")
APP = sys.argv[2] if len(sys.argv) > 2 else "http://weftprod:8080"
OUT = "/out"

_id = 0
TAB_ID = None
SESSION = None


def rpc(ws, method, params=None):
    global _id
    _id += 1
    payload = {"id": _id, "method": method, "params": params or {}}
    if SESSION and not method.startswith("Target."):
        payload["sessionId"] = SESSION
    ws.send(json.dumps(payload))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id:
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error']}")
            return msg.get("result", {})


def evaluate(ws, expr):
    """Run an async JS expression to completion and return its value."""
    result = rpc(ws, "Runtime.evaluate", {
        "expression": expr,
        "awaitPromise": True,
        "returnByValue": True,
        "timeout": 30000,
    })
    if result.get("exceptionDetails"):
        raise RuntimeError(json.dumps(result["exceptionDetails"])[:400])
    return result.get("result", {}).get("value")


def goto(ws, path, settle_ms=2600):
    rpc(ws, "Page.navigate", {"url": APP + path})
    # Wait for load + hydration + entrance animations.
    for _ in range(100):
        state = evaluate(ws, "document.readyState")
        if state == "complete":
            break
        time.sleep(0.2)
    time.sleep(settle_ms / 1000)


def viewport(ws, width, height, scale=2):
    rpc(ws, "Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height,
        "deviceScaleFactor": scale, "mobile": False,
    })


def shot(ws, name, full=False):
    params = {"format": "png"}
    if full:
        params["captureBeyondViewport"] = True
    last = None
    for attempt in range(4):
        try:
            data = rpc(ws, "Page.captureScreenshot", params)["data"]
            with open(f"{OUT}/{name}.png", "wb") as f:
                f.write(base64.b64decode(data))
            print(f"saved {name}.png")
            return
        except Exception as e:  # transient surface/timeout hiccups
            last = e
            print(f"retry {name} ({attempt + 1}): {e}")
            time.sleep(2.5)
    raise last


SET_VAL = """
window.setVal = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
};
window.sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t || b.textContent.includes(t));
window.tab = (t) => [...document.querySelectorAll('[role="tab"]')].find(x => x.textContent.trim() === t);
window.waitFor = async (sel, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const el = document.querySelector(sel);
    if (el) return el;
    await sleep(150);
  }
  throw new Error('timeout waiting for ' + sel);
};
window.waitBtn = async (t, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const b = window.btn(t);
    if (b) return b;
    await sleep(150);
  }
  throw new Error('timeout waiting for button ' + t);
};
"""


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "phase1"

    # browserless: connect to the browser endpoint; it launches a fresh
    # chromium per connection and tears it down on disconnect.
    global SESSION
    ws_url = CHROME.replace("http://", "ws://")
    ws = websocket.create_connection(ws_url, timeout=180)
    target = rpc(ws, "Target.createTarget", {"url": "about:blank"})
    attach = rpc(ws, "Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})
    SESSION = attach["sessionId"]
    rpc(ws, "Page.enable")
    rpc(ws, "Runtime.enable")
    rpc(ws, "Emulation.setEmulatedMedia", {
        "features": [{"name": "prefers-color-scheme", "value": "light"}],
    })
    viewport(ws, 1280, 800)

    if phase == "schema":
        goto(ws, "/i/local/schema", settle_ms=3200)
        evaluate(ws, SET_VAL + """
(async () => {
  await waitFor('[aria-label="Alias list"] li', 15000);
  await sleep(500);
})()""")
        shot(ws, "02-schema")
        return

    if phase == "ops":
        viewport(ws, 1280, 1000)
        goto(ws, "/i/local/ops", settle_ms=3500)
        shot(ws, "14-ops")
        evaluate(ws, "window.scrollTo(0, document.body.scrollHeight); 1")
        time.sleep(0.8)
        shot(ws, "14-ops-b")
        return

    if phase == "tenants":
        goto(ws, "/i/local/c/Product/tenants", settle_ms=3200)
        shot(ws, "13-tenants")
        return

    if phase == "diff":
        viewport(ws, 1280, 800, scale=1)
        goto(ws, "/i/local/diff", settle_ms=2200)
        evaluate(ws, """
const st = document.createElement('style');
st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
document.head.appendChild(st);
1""")
        time.sleep(1)
        shot(ws, "15-diff")
        return

    if phase == "authgate":
        viewport(ws, 1280, 560)
        goto(ws, "/")
        assert evaluate(ws, "!!document.querySelector('form[aria-label=\"Authentication required\"]')")
        shot(ws, "16-auth-gate")
        return

    if phase == "readonly":
        goto(ws, "/i/local/schema", settle_ms=3200)
        assert evaluate(ws, "[...document.querySelectorAll('[role=\"status\"]')].some(s => s.textContent.includes('Read-only'))")
        assert evaluate(ws, "document.querySelectorAll('table tbody tr').length > 0")
        shot(ws, "17-read-only")
        return

    # ---------------- phase 1 ----------------
    goto(ws, "/")
    shot(ws, "01-instances")

    goto(ws, "/i/local/schema", settle_ms=3200)
    evaluate(ws, SET_VAL + """
(async () => {
  await waitFor('[aria-label="Alias list"] li', 15000);
  await sleep(400);
})()""")
    shot(ws, "02-schema")

    evaluate(ws, SET_VAL + """
(async () => {
  (await waitBtn('New collection')).click();
  await waitFor('form[aria-label="New collection"] input[placeholder="Article"]');
  setVal(document.querySelector('form[aria-label="New collection"] input[placeholder="Article"]'), 'Product');
  setVal(document.querySelector('input[aria-label="Property 1 name"]'), 'name');
  await sleep(200);
})()""")
    shot(ws, "03-new-collection")

    goto(ws, "/i/local/c/Article", settle_ms=3000)
    shot(ws, "04-class-detail")
    evaluate(ws, SET_VAL + """
(async () => {
  (await waitBtn('Delete collection')).click();
  await waitFor('input[aria-label="Type the collection name to confirm"]');
  setVal(document.querySelector('input[aria-label="Type the collection name to confirm"]'), 'Article');
  await sleep(200);
})()""")
    viewport(ws, 1280, 1000)
    shot(ws, "05-delete-confirm")

    viewport(ws, 1280, 1000)
    goto(ws, "/i/local/c/Article/objects", settle_ms=3000)
    evaluate(ws, SET_VAL + """
(async () => {
  const row = await waitFor('table tbody tr');
  (row.querySelector('button, td') ?? row).click();
  await waitFor('[aria-label="Object JSON"]');
  await sleep(400);
})()""")
    shot(ws, "06-browse")

    evaluate(ws, SET_VAL + """
(async () => {
  (await waitBtn('+ Add filter')).click();
  await waitFor('select[aria-label="Filter 1 property"]');
  setVal(document.querySelector('select[aria-label="Filter 1 property"]'), 'category');
  await sleep(250);
  setVal(document.querySelector('input[aria-label="Filter 1 value"]'), 'science');
  window.btn('Apply filters').click();
  await sleep(1200);
  setVal(document.querySelector('select[aria-label="Facet property"]'), 'category');
  await sleep(1200);
})()""")
    shot(ws, "07-filters-facets")

    evaluate(ws, SET_VAL + """
(async () => {
  window.tab('Search').click();
  await sleep(400);
  const q = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Query')).querySelector('input');
  setVal(q, 'demo content');
  [...document.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Search')).click();
  await waitFor('[aria-label="Search results"]');
  await sleep(500);
})()""")
    shot(ws, "08-search")

    evaluate(ws, SET_VAL + """
(async () => {
  window.btn('Clear')?.click();
  await sleep(500);
  window.tab('Map').click();
  await sleep(2500);
  if (!document.querySelector('svg[aria-label="Vector space map"] circle')) throw new Error('map empty');
})()""")
    shot(ws, "09-map")

    evaluate(ws, SET_VAL + """
(async () => {
  window.tab('Import').click();
  await sleep(300);
  const ta = document.querySelector('form[aria-label="Import objects"] textarea');
  setVal(ta, '{"title":"My first import","body":"Hello from the manual","category":"docs","wordCount":5}\\n{"title":"Second object","body":"Another line","category":"docs","wordCount":3}');
  document.querySelector('form[aria-label="Import objects"] button[type="submit"]').click();
  await sleep(1800);
  if (!document.querySelector('form[aria-label="Import objects"] [role="status"]')) throw new Error('no report');
})()""")
    shot(ws, "10-import")

    evaluate(ws, SET_VAL + """
(async () => {
  window.tab('Browse').click();
  const row = await waitFor('table tbody tr');
  (row.querySelector('button, td') ?? row).click();
  (await waitBtn('Edit')).click();
  await waitFor('form[aria-label="Edit object"]');
  await sleep(300);
  if (!document.querySelector('form[aria-label="Edit object"]')) throw new Error('editor not open');
})()""")
    shot(ws, "11-edit-object")
    # Clean up the two imported demo objects.
    evaluate(ws, """
(async () => {
  const f = await (await fetch('/api/v1/instances/local/collections/Article/objects?where=' +
    encodeURIComponent('{"conditions":[{"path":"category","operator":"Equal","value":"docs"}]}'))).json();
  for (const o of f.objects) {
    await fetch('/api/v1/instances/local/collections/Article/objects/' + o.id, {method: 'DELETE'});
  }
  return f.objects.length;
})()""")

    viewport(ws, 1280, 900)
    goto(ws, "/i/local/console", settle_ms=2000)
    evaluate(ws, SET_VAL + """
(async () => {
  const ta = document.querySelector('textarea');
  setVal(ta, '{\\n  Aggregate {\\n    Article(groupBy: ["category"]) {\\n      groupedBy { value }\\n      meta { count }\\n    }\\n  }\\n}');
  await sleep(150);
  document.querySelector('button[type="submit"]').click();
  await waitFor('[aria-label="Result JSON"]');
  await sleep(300);
})()""")
    shot(ws, "12-console")

    viewport(ws, 1280, 800)
    goto(ws, "/i/local/c/Product/tenants", settle_ms=3200)
    shot(ws, "13-tenants")

    viewport(ws, 1280, 1000)
    goto(ws, "/i/local/ops", settle_ms=3500)
    shot(ws, "14-ops")
    evaluate(ws, "window.scrollTo(0, document.body.scrollHeight); 1")
    time.sleep(0.8)
    shot(ws, "14-ops-b")

    viewport(ws, 1280, 800)
    goto(ws, "/i/local/diff", settle_ms=2000)
    shot(ws, "15-diff")

    print("phase1 complete")


def cleanup(tab_id):
    for method in ("PUT", "GET"):
        try:
            urllib.request.urlopen(
                urllib.request.Request(f"{CHROME}/json/close/{tab_id}", method=method))
            return
        except Exception:
            continue


if __name__ == "__main__":
    main()
