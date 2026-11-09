// Runs once, when the MongoDB volume is first created (docker-entrypoint-initdb.d), as the root user that
// docker-compose.prod.yml configures. Creates the three SampForce users with the passwords from deploy/.env:
//
//   sampforce_app     readWrite on the SampForce database: the API and the worker. Workspace isolation is enforced
//                     by the application's database client (ADR 0058), not by this user.
//   sampforce_admin   readWrite and dbAdmin: the set-up job that creates and drops indexes.
//   sampforce_backup  the built-in backup role: mongodump only.
//
// Changing the passwords in .env later does NOT change these users; see SERVER_SETUP.md, "Changing a database
// password".
const dbName = process.env.SAMPFORCE_DB || 'sampforce';
const admin = db.getSiblingDB('admin');
const users = [
  { user: 'sampforce_app', pwd: process.env.SAMPFORCE_APP_PASSWORD, roles: [{ role: 'readWrite', db: dbName }] },
  { user: 'sampforce_admin', pwd: process.env.SAMPFORCE_ADMIN_PASSWORD, roles: [{ role: 'readWrite', db: dbName }, { role: 'dbAdmin', db: dbName }] },
  { user: 'sampforce_backup', pwd: process.env.SAMPFORCE_BACKUP_PASSWORD, roles: [{ role: 'backup', db: 'admin' }] },
];
for (const u of users) {
  if (!u.pwd) throw new Error(`no password for ${u.user}; run scripts/generate-secrets.sh`);
  if (!admin.getUser(u.user)) admin.createUser(u);
}
