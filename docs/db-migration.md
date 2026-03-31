# DB Migration

Migrate the `nosana_deployments` database from the old DocumentDB 3.6 cluster to the new DocumentDB 8.0 cluster.
The migration uses `mongodump` and `mongorestore` via a temporary Kubernetes pod. No data transformation is needed.

**Collections**: deployments, events, vaults, jobs, tasks, revisions, results, _migrations.

## Open DB security groups to allow connectivity

Open both source and destination security groups to allow the migration pod to connect.

```bash
# Set the environment: dev or prd
environment=dev

aws_region=eu-west-1
aws_profile=nos-${environment}-breakglass
db_port=27017

# Find the VPC
vpcId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 describe-vpcs \
        --filter Name=tag:Name,Values=platform-${environment}-vpc \
    | jq -r '.Vpcs[].VpcId'
)

# Find the SOURCE security group (old DocumentDB 3.6)
srcSgId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 get-security-groups-for-vpc \
        --vpc-id ${vpcId} \
        --filter Name=group-name,Values=*docdb-deployment-manager* \
    | jq -r '.SecurityGroupForVpcs[].GroupId'
)

# Find the DESTINATION security group (new DocumentDB 8.0)
dstSgId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 get-security-groups-for-vpc \
        --vpc-id ${vpcId} \
        --filter Name=group-name,Values=*documentdb* \
    | jq -r '.SecurityGroupForVpcs[].GroupId'
)

# Open the security groups
aws --profile ${aws_profile} --region ${aws_region} ec2 authorize-security-group-ingress \
    --group-id ${srcSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr 10.105.0.0/16

aws --profile ${aws_profile} --region ${aws_region} ec2 authorize-security-group-ingress \
    --group-id ${dstSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr 10.105.0.0/16
```

## Run migration container

Pod definition.
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: docdb-migration
spec:
  containers:
    - name: main
      image: mongo:8.0
      command: ["tail", "-f", "/dev/null"]
      envFrom:
        - secretRef:
            name: docdb-migration-credentials
      volumeMounts:
        - mountPath: /data
          name: data
        - name: scripts
          mountPath: /scripts-src
  volumes:
    - name: data
      emptyDir:
        sizeLimit: 2Gi
    - name: scripts
      configMap:
        name: docdb-migration-scripts
        items:
          - key: dump.sh
            path: dump.sh
          - key: restore.sh
            path: restore.sh
          - key: verify.sh
            path: verify.sh
```

Save the definition to a file called `docdb-migration.yaml`.

Create a secret with DB credentials.
```bash
# Set kubectl context to dev or prd

# Source credentials (from existing deployment-manager secrets)
srcHost="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_HOST"]' | base64 --decode)"
srcPort="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_PORT"]' | base64 --decode)"
srcUsername="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_USERNAME"]' | base64 --decode)"
srcPassword="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_PASSWORD"]' | base64 --decode)"

# Destination credentials (from 1Password: "Managed by Terraform: [ENV] DocumentDB credentials")
dstHost="<destination-hostname>"
dstPort="27017"
dstUsername="<destination-username>"
dstPassword="<destination-password>"

kubectl -n deployment-manager create secret generic docdb-migration-credentials \
  --from-literal="SRC_DBNAME=nosana_deployments" \
  --from-literal="SRC_HOST=${srcHost}" \
  --from-literal="SRC_PORT=${srcPort}" \
  --from-literal="SRC_USERNAME=${srcUsername}" \
  --from-literal="SRC_PASSWORD=${srcPassword}" \
  --from-literal="DST_DBNAME=nosana_deployment" \
  --from-literal="DST_HOST=${dstHost}" \
  --from-literal="DST_PORT=${dstPort}" \
  --from-literal="DST_USERNAME=${dstUsername}" \
  --from-literal="DST_PASSWORD=${dstPassword}"
```

Create a configmap with scripts to run the migration.
```bash
kubectl -n deployment-manager create configmap docdb-migration-scripts \
  --from-file=dump.sh=scripts/db-migration/dump.sh \
  --from-file=restore.sh=scripts/db-migration/restore.sh \
  --from-file=verify.sh=scripts/db-migration/verify.sh
```

Run pod.
```bash
kubectl -n deployment-manager apply -f docdb-migration.yaml
```

Get a shell on the pod container.
```bash
kubectl -n deployment-manager exec -it docdb-migration -- bash

# Download the Amazon DocumentDB TLS certificate bundle
curl -sO https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
mv global-bundle.pem /data/

mkdir /scripts
cp /scripts-src/* /scripts/
chmod +x /scripts/*.sh

/scripts/dump.sh
/scripts/restore.sh
/scripts/verify.sh
# Verify that all collection counts match between source and destination
echo $?

# Leave the shell and exit the pod
ctrl^d
```

## Cleanup

Delete pod, secret and configmap.
```bash
kubectl -n deployment-manager delete -f docdb-migration.yaml --force=true
kubectl -n deployment-manager delete secret docdb-migration-credentials
kubectl -n deployment-manager delete configmap docdb-migration-scripts
```

Close off security groups.
```bash
aws --profile ${aws_profile} --region ${aws_region} ec2 revoke-security-group-ingress \
    --group-id ${srcSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr 10.105.0.0/16

aws --profile ${aws_profile} --region ${aws_region} ec2 revoke-security-group-ingress \
    --group-id ${dstSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr 10.105.0.0/16
```
