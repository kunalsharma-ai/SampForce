// Runs once, when the MongoDB volume is first created (docker-entrypoint-initdb.d), as the root user that
// docker-compose.prod.yml configures. Creates the three SampForce users with the passwords from deploy/.env:
//
//   sampforce_app     the custom role sampforce_runtime on the SampForce database: the API and the worker. It can
//                     read, insert, update and delete documents, but not create, drop or change indexes or drop
//                     collections. (MongoDB's built-in readWrite would allow dropping indexes, which would remove
//                     the unique indexes the application relies on.) Workspace isolation is enforced by the
//                     application's database client (ADR 0058), not by this user.
//   sampforce_admin   readWrite and dbAdmin: the set-up job that creates and drops indexes.
//   sampforce_backup  the built-in backup role: mongodump only.
//
// Changing the passwords in .env later does NOT change these users; see SERVER_SETUP.md, "Changing a database
// password".
const dbName = process.env.SAMPFORCE_DB || 'sampforce';
const admin = db.getSiblingDB('admin');

// Defined in the admin database so that scripts/restore.sh can add the restored database to it.
const RUNTIME_ACTIONS = ['find', 'insert', 'update', 'remove', 'createCollection', 'listCollections', 'listIndexes', 'collStats', 'dbStats', 'killCursors'];
if (!admin.getRole('sampforce_runtime')) {
  admin.createRole({
    role: 'sampforce_runtime',
    privileges: [{ resource: { db: dbName, collection: '' }, actions: RUNTIME_ACTIONS }],
    roles: [],
  });
}

const users = [
  { user: 'sampforce_app', pwd: process.env.SAMPFORCE_APP_PASSWORD, roles: [{ role: 'sampforce_runtime', db: 'admin' }] },
  { user: 'sampforce_admin', pwd: process.env.SAMPFORCE_ADMIN_PASSWORD, roles: [{ role: 'readWrite', db: dbName }, { role: 'dbAdmin', db: dbName }] },
  { user: 'sampforce_backup', pwd: process.env.SAMPFORCE_BACKUP_PASSWORD, roles: [{ role: 'backup', db: 'admin' }] },
];
for (const u of users) {
  if (!u.pwd) throw new Error(`no password for ${u.user}; run scripts/generate-secrets.sh`);
  if (!admin.getUser(u.user)) admin.createUser(u);
}
