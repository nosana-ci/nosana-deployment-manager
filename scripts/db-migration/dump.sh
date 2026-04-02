#!/bin/bash

set -e

DB_NAME="${SRC_DBNAME}"
SRC_URI="mongodb://${SRC_USERNAME}:${SRC_PASSWORD}@${SRC_HOST}:${SRC_PORT}/${DB_NAME}"

echo "Dumping ${DB_NAME} from source cluster..."
mongodump \
    --ssl --sslCAFile /data/global-bundle.pem \
    --uri="${SRC_URI}" \
    --out=/data/dump

echo ""
echo "Dump completed. Collection sizes:"
for f in /data/dump/${DB_NAME}/*.bson; do
    echo "  $(basename "$f"): $(du -h "$f" | cut -f1)"
done
