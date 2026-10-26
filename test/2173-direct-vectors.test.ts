import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as w from 'beebeeb-wasm'
import v from './fixtures/direct_transfer.json'
w.initSync({ module: readFileSync('packages/beebeeb-wasm/beebeeb_wasm_bg.wasm') })
const bytes = (x: unknown) => new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x))
function code(fn: () => unknown) { try { fn(); return 'ok' } catch (e) { return (e as { code: string }).code } }
function planner(s: any) { const p = new w.WasmDownloadPlanner(v.discoveries[s.discovery as keyof typeof v.discoveries], 'https://api.beebeeb.test', v.file_id, s.seed); if (s.max_in_flight_bytes !== undefined) p.setMaxInFlightBytes(Number(s.max_in_flight_bytes)); return p }
test('download fixture pinned to core 3f62765a3', () => {
  expect(createHash('sha256').update(readFileSync('test/fixtures/direct_transfer.json')).digest('hex')).toBe('8f23b66819afcb0f6ac319e91b2a1a1246da9e9b0a1308a132655eb37541787a')
  expect([v.authority.length, v.classify.length, v.redact.length, v.scrub.length, v.pinned_retry.length, v.discovery_cache.length, v.planner.length, v.health.length, v.resume_transport.length]).toEqual([59, 121, 6, 4, 20, 9, 42, 8, 20])
})
test('every authority, classifier, scrubber and pinned retry row through shipped WASM', () => {
  for (const r of v.authority) expect(code(() => w.checkStorageUrl(r.url, v.discoveries[r.discovery as keyof typeof v.discoveries], r.api_base))).toBe(r.expect)
  for (const r of v.classify) expect(w.classifyDirectAnswer(r.call, r.status, r.content_type, bytes(r.body), r.retry_after)).toEqual(r.expect)
  for (const r of v.redact) expect(w.redactUrl(r.input)).toBe(r.expect)
  for (const r of v.scrub) expect(w.scrubText(r.input)).toBe(r.expect)
  for (const r of v.pinned_retry) expect(w.pinnedRetryDecision(r.outcome, r.attempt, Number(r.waited_ms))).toEqual(r.expect)
})
test('all discovery cache, health and resume rows through shipped WASM', () => {
  for (const s of v.discovery_cache) {
    const c = new w.WasmDirectDiscoveryCache()
    for (const st of s.steps as any[]) {
      if (st.op === 'lookup') expect(c.lookup(st.now).kind).toBe(st.expect)
      else c.record(st.outcome, st.body == null ? undefined : bytes(st.body.startsWith('@') ? v.discoveries[st.body.slice(1) as keyof typeof v.discoveries] : st.body), st.now)
    }
    c.free()
  }
  for (const s of v.health) {
    const h = new w.WasmDirectHealth()
    for (const st of s.steps as any[]) {
      switch (st.op) {
        case 'gave_up': h.gaveUp(st.direction, st.now); break
        case 'restore': h.restore(st.direction, st.ms); break
        case 'may_start': expect(h.mayStart(st.direction, st.now)).toBe(st.expect); break
        case 'may_start_file': expect(h.mayStartFile(st.direction, st.now, st.file_gave_up)).toBe(st.expect); break
        case 'last_gave_up': expect(h.lastGaveUpMs(st.direction) ?? null).toBe(st.expect); break
        default: throw new Error('unknown health op')
      }
    }
    h.free()
  }
  for (const r of v.resume_transport) expect(w.resumeTransport(r.recorded, r.discovery, r.forced_api)).toBe(r.expect)
})
test('42 planner scenarios, 367 steps and 21 refusal rows through shipped WASM', () => {
  let steps = 0, refusals = 0
  for (const s of v.planner as any[]) {
    for (const r of s.refusals ?? []) {
      const p = planner(s); expect(p.poll(v.t0_ms).kind).toBe('request_window')
      expect(p.windowAnswered(bytes(r.body ?? r.response), v.t0_ms)).toBe(r.expect)
      p.free(); refusals++
    }
    const p = planner(s)
    for (const st of s.steps ?? []) {
      const now = st.now ?? 0
      switch (st.op) {
        case 'poll': {
          const step = p.poll(now)
          let got: any = step
          if (step.kind === 'fetch') { got = { kind: 'fetch', index: step.index, url: step.url.raw(), length: step.length }; step.url.free() }
          if (st.expect.until_ms_between) {
            expect(got.kind).toBe('wait'); expect(got.until_ms).toBeGreaterThanOrEqual(st.expect.until_ms_between[0]); expect(got.until_ms).toBeLessThanOrEqual(st.expect.until_ms_between[1])
          } else expect(got).toEqual(st.expect)
          break
        }
        case 'window_answered': expect(p.windowAnswered(bytes(st.body ?? st.response), now).replace(/^accepted$/, 'ok')).toBe(st.expect ?? 'ok'); break
        case 'window_failed': p.windowFailed(st.outcome, now); break
        case 'window_malformed': p.windowMalformed(); break
        case 'storage_given_up': expect(p.storageGivenUp()).toBe(st.expect); break
        case 'inspect': expect({ geometry: p.geometry(), pinned_version: p.pinnedVersion() ?? null, consumed: p.consumedCount(), in_flight: p.inFlight() }).toEqual(st.expect); break
        default: {
          const names = { fetch_ok: 'fetchOk', fetch_failed: 'fetchFailed', api_fetch_failed: 'apiFetchFailed', chunk_unauthentic: 'chunkUnauthentic', consumed: 'consumed' } as const
          const method = names[st.op as keyof typeof names]
          if (!method) throw new Error('unknown planner op')
          expect(code(() => p[method](st.index, now))).toBe(st.expect ?? 'ok')
        }
      }
      steps++
    }
    p.free()
  }
  expect([steps, refusals]).toEqual([367, 21])
})
