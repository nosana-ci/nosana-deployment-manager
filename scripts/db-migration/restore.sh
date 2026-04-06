#!/usr/bin/bash

set -e

DB_NAME="${DST_DBNAME}"
TLS_OPTS="tls=true&tlsCAFile=/data/global-bundle.pem&replicaSet=rs0"
DST_URI="mongodb://${DST_USERNAME}:${DST_PASSWORD}@${DST_HOST}:${DST_PORT}/${DB_NAME}?${TLS_OPTS}"

echo "Restoring ${DB_NAME} to destination cluster..."
mongorestore \
    -- drop \
    --uri="${DST_URI}" \
    --dir=/data/dump/${SRC_DBNAME}

echo ""
echo "Restore completed."
