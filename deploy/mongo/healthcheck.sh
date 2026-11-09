#!/usr/bin/env bash
# Compose health check for the mongo service. On the first start it also initiates the one-member replica set
# (under the service name, so the API and worker reach it as mongo:27017). Healthy once this member is primary.
set -euo pipefail
mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval '
  try { rs.status(); } catch (e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }); }
  if (!db.hello().isWritablePrimary) quit(1);
'
