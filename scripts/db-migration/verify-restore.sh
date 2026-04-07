#!/usr/bin/bash

set -e

DB_NAME="${DST_DBNAME}"
TLS_OPTS="tls=true&tlsCAFile=/data/global-bundle.pem&replicaSet=rs0&authMechanism=SCRAM-SHA-1"

echo "=== DESTINATION cluster ==="
mongosh "mongodb://${DST_USERNAME}:${DST_PASSWORD}@${DST_HOST}:${DST_PORT}/${DB_NAME}?${TLS_OPTS}" --quiet \
    --eval 'print("Collection: Document Count"); db.getCollectionNames().forEach(function(c) { print(c + ": " + db.getCollection(c).count()); });'
