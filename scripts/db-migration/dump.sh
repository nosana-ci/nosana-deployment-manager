#!/usr/bin/bash

set -e

DB_NAME="${SRC_DBNAME}"
TLS_OPTS="tls=true&tlsCAFile=/data/global-bundle.pem&replicaSet=rs0"
SRC_URI="mongodb://${SRC_USERNAME}:${SRC_PASSWORD}@${SRC_HOST}:${SRC_PORT}/${DB_NAME}?${TLS_OPTS}"

echo "Dumping ${DB_NAME} from source cluster..."
mongodump \
    --uri="${SRC_URI}" \
    --out=/data/dump

echo ""
echo "Dump completed. Collection sizes:"
for f in /data/dump/${DB_NAME}/*.bson; do
    echo "  $(basename "$f"): $(du -h "$f" | cut -f1)"
done
