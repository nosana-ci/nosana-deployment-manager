#!/usr/bin/bash

set -e

DB_NAME="${DST_DBNAME}"
TLS_OPTS="tls=true&tlsCAFile=/data/global-bundle.pem&replicaSet=rs0"

echo "=== SOURCE cluster ==="
mongosh "mongodb://${SRC_USERNAME}:${SRC_PASSWORD}@${SRC_HOST}:${SRC_PORT}/${DB_NAME}?${TLS_OPTS}" --quiet \
    --eval "db.getCollectionNames().forEach(function(c) { print(c + ': ' + db[c].countDocuments({})); })"

echo ""
echo "=== DESTINATION cluster ==="
mongosh "mongodb://${DST_USERNAME}:${DST_PASSWORD}@${DST_HOST}:${DST_PORT}/${DB_NAME}?${TLS_OPTS}" --quiet \
    --eval "db.getCollectionNames().forEach(function(c) { print(c + ': ' + db[c].countDocuments({})); })"
