#!/usr/bin/env bash
# Starts MongoDB for SampForce: a one-member replica set (transactions need one) with authentication.
#
# A replica set with authentication needs a key file that only the mongodb user can read. The file comes from
# deploy/mongo/keyfile (created by scripts/generate-secrets.sh) and is copied here with the ownership and mode
# mongod insists on, so the host file's owner does not matter.
set -euo pipefail
install -m 400 -o mongodb -g mongodb /sampforce/keyfile /tmp/mongo-keyfile
exec docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all --keyFile /tmp/mongo-keyfile "$@"
