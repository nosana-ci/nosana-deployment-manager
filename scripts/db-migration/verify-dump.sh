#!/bin/bash

set -e

DB_NAME="${SRC_DBNAME}"

echo "=== SOURCE cluster ==="
mongo "mongodb://${SRC_USERNAME}:${SRC_PASSWORD}@${SRC_HOST}:${SRC_PORT}/${DB_NAME}?${TLS_OPTS}" \
    --quiet \
    --ssl --sslCAFile /data/global-bundle.pem \
    --eval 'print("Collection: Document Count"); db.getCollectionNames().forEach(function(c) { print(c + ": " + db.getCollection(c).count()); });'
