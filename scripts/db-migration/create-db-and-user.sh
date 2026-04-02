#!/usr/bin/bash

set -e

DB_NAME="${DST_DBNAME}"
TLS_OPTS="tls=true&tlsCAFile=/data/global-bundle.pem&replicaSet=rs0"
DST_URI="mongodb://${MASTER_USERNAME}:${MASTER_PASSWORD}@${DST_HOST}:${DST_PORT}/admin?${TLS_OPTS}"

echo "Creating destination ${DB_NAME} and user ${DST_USERNAME}..."
mongosh "${DST_URI}" --eval "
    db = db.getSiblingDB('${DB_NAME}');
    db.createUser({
        user: '${DST_USERNAME}',
        pwd: '${DST_PASSWORD}',
        roles: [{ role: 'readWrite', db: '${DB_NAME}' }]
    });
"


echo ""
echo "DB and suer created"
