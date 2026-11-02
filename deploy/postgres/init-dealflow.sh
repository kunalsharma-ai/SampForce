#!/usr/bin/env bash
# Runs once, when the Postgres volume is first created (docker-entrypoint-initdb.d). Creates the three DealFlow
# roles (owner, runtime without BYPASSRLS, read-only backup) and the dealflow database, using the passwords that
# docker-compose.prod.yml passes from deploy/.env. Changing those passwords later does NOT change the roles; see
# SERVER_SETUP.md, "Changing a database password".
set -euo pipefail
bash /dealflow/db-setup.sh dealflow
