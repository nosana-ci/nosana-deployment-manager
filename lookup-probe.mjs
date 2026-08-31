import { MongoClient } from 'mongodb';
const c = new MongoClient('mongodb://localhost:37018/?replicaSet=rs0&directConnection=true');
await c.connect();
const col = c.db('t').collection('jobs');
await col.deleteMany({});
await col.insertOne({ job: 'j1', state: 'QUEUED' });

const cs = col.watch([], { fullDocument: 'updateLookup' });
const seen = [];
cs.on('change', (e) => {
  if (e.operationType !== 'update') return;
  seen.push({ changed: e.updateDescription.updatedFields.state, lookedUp: e.fullDocument?.state });
});
await new Promise(r => setTimeout(r, 700));

// the real sequence: RUNNING -> COMPLETED -> STOPPED, back to back
for (const state of ['RUNNING', 'COMPLETED', 'STOPPED']) {
  await col.updateOne({ job: 'j1' }, { $set: { state } });
}
await new Promise(r => setTimeout(r, 2000));
console.log('change -> fullDocument seen by a consumer:');
for (const s of seen) console.log(`  changed=${s.changed}  fullDocument.state=${s.lookedUp}`);
const order = seen.map(s => s.lookedUp);
console.log('\ndelivered order:', order.join(' -> '));
await cs.close(); await c.close();
