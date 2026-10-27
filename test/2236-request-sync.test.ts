import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { rowsSignature } from '../src/lib/sync-rows'

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSyncOps: async () => [], getSnapshot: async () => ({seq_id:0,nodes:[]}),
  getStreamToken: async () => ({stream_token:'test'}), submitSyncOps: async () => ({applied:[],rejected:[]}),
})
const storage = new Map<string,string>()
;(globalThis as any).localStorage = {
  getItem:(key:string)=>storage.get(key) ?? null,
  setItem:(key:string,value:string)=>{storage.set(key,value)},
  removeItem:(key:string)=>{storage.delete(key)},
}
const { SyncClient } = await import('../src/lib/sync-client')
const envelope = {file_request_id:'request-2236',sender_ephemeral_pubkey:'ephemeral',wrapped_content_key:'wrapped'}

test('2236 incoming request create retains its key envelope', () => {
  const client = new SyncClient()
  client.ingestStreamFrame(JSON.stringify({seq_id:1,op_type:'file_create',payload:{id:'file-2236',...envelope}}))
  expect(client.getNode('file-2236')).toMatchObject(envelope)
})
test('2236 each request envelope field changes the drive row signature', () => {
  const file = {id:'file-2236',name_encrypted:'name',size_bytes:1,updated_at:'now'} as any
  for (const [field,value] of Object.entries(envelope)) {
    expect(rowsSignature([{...file,[field]:value}])).not.toBe(rowsSignature([file]))
  }
})
test('2236 drive projection carries each request envelope field', () => {
  const source = readFileSync(new URL('../src/pages/drive.tsx',import.meta.url),'utf8')
  const mapper = source.slice(source.indexOf('const syncNodeToDriveFile'),source.indexOf('// refreshFromSync'))
  for (const field of Object.keys(envelope)) expect(mapper.includes(`${field}: n.${field}`)).toBe(true)
})
