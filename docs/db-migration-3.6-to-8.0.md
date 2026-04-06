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
        --filter Name=group-name,Values=nos-${environment}-docdb-deployment-manager-${environment} \
    | jq -r '.SecurityGroupForVpcs[].GroupId'
)

# Find the DESTINATION security group (new DocumentDB 8.0)
dstSgId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 get-security-groups-for-vpc \
        --vpc-id ${vpcId} \
        --filter Name=group-name,Values=nos-${environment}-platform-documentdb-${environment} \
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
    - name: mongo3
      image: mongo:3.6
      command: ["tail", "-f", "/dev/null"]
      envFrom:
        - secretRef:
            name: docdb-migration-credentials
      volumeMounts:
        - mountPath: /data
          name: data
        - name: scripts
          mountPath: /scripts-src
    - name: mongo8
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
      hostPath:
        path: /tmp/docdb-migration
    - name: scripts
      configMap:
        name: docdb-migration-scripts
        items:
          - key: dump.sh
            path: dump.sh
          - key: create-db-and-user.sh
            path: create-db-and-user.sh
          - key: restore.sh
            path: restore.sh
          - key: verify-dump.sh
            path: verify-dump.sh
          - key: verify-restore.sh
            path: verify-restore.sh
```

Save the definition to a file called `docdb-migration.yaml`.

Gather required connection information (credentials, hostnames, etc)
```bash
# Set kubectl context to dev or prd

# Source credentials (from existing deployment-manager secrets)
srcHost="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_HOST"]' | base64 --decode)"
srcPort="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_PORT"]' | base64 --decode)"
srcUsername="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_USERNAME"]' | base64 --decode)"
srcPassword="$(kubectl get secret -n deployment-manager deployment-manager-variable-secrets -o json | jq -r '.data["DOCDB_PASSWORD"]' | base64 --decode)"

# 1Password items 
dstPasswordOpItem_dev="seut5ho7podnxbuow6xaizidmu"
dstPasswordOpItem_prd="rjxzxk7qf53owm3sn6tjlz46yi"
masterDbOpItem_dev="jkuzhnpvbzfrzwejqa6pjtvktm"
masterDbOpItem_prd="xqb6zkfnjpvombjdihnaaotczq"
if [[ "${environment}" == "dev" ]]; then
  dstPasswordOpItem="${dstPasswordOpItem_dev}"
  masterOpItem="${masterDbOpItem_dev}"
elif [[ "${environment}" == "prd" ]]; then
  dstPasswordOpItem="${dstPasswordOpItem_prd}"
  masterOpItem="${masterDbOpItem_prd}"
fi

# Destination credentials (from 1Password)
dstPort="27017"
dstHost="$(nos-op-ops-fetch "${dstPasswordOpItem}" "hostname")"
dstUsername="$(nos-op-ops-fetch "${dstPasswordOpItem}" "username")"
dstPassword="$(nos-op-ops-fetch "${dstPasswordOpItem}" "password")"

# Master credentials (from 1Password)
masterUsername="$(nos-op-ops-fetch "${masterOpItem}" "username")"
masterPassword="$(nos-op-ops-fetch "${masterOpItem}" "password")"
```

Create a secret with connection information and a configmap with scripts to run the migration.
```bash
kubectl create secret generic docdb-migration-credentials \
  --from-literal="SRC_DBNAME=nosana_deployments" \
  --from-literal="SRC_HOST=${srcHost}" \
  --from-literal="SRC_PORT=${srcPort}" \
  --from-literal="SRC_USERNAME=${srcUsername}" \
  --from-literal="SRC_PASSWORD=${srcPassword}" \
  --from-literal="DST_DBNAME=nosana_deployment" \
  --from-literal="DST_HOST=${dstHost}" \
  --from-literal="DST_PORT=${dstPort}" \
  --from-literal="DST_USERNAME=${dstUsername}" \
  --from-literal="DST_PASSWORD=${dstPassword}" \
  --from-literal="MASTER_USERNAME=${masterUsername}" \
  --from-literal="MASTER_PASSWORD=${masterPassword}"

kubectl create configmap docdb-migration-scripts \
  --from-file=dump.sh=scripts/db-migration/dump.sh \
  --from-file=restore.sh=scripts/db-migration/restore.sh \
  --from-file=verify-dump.sh=scripts/db-migration/verify-dump.sh \
  --from-file=verify-restore.sh=scripts/db-migration/verify-restore.sh \
  --from-file=create-db-and-user.sh=scripts/db-migration/create-db-and-user.sh
```

Run pod.
```bash
kubectl apply -f docdb-migration.yaml
```

Get a shell on the mongo3 pod container to perform the dump
```bash
kubectl exec -it docdb-migration -c mongo3 -- bash

# Install curl
apt-get update && apt-get install -y curl

# Download the Amazon DocumentDB TLS certificate bundle
curl -sO https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
mv global-bundle.pem /data/

mkdir /scripts
cp /scripts-src/* /scripts/
chmod +x /scripts/*.sh

/scripts/dump.sh
echo $?
/scripts/verify-dump.sh
# Take note of the collection count stats to later compare against the restore verification

# Leave the shell and exit the pod
ctrl^d
```

Get a shell on the mongo8 pod container to perform the restore
```bash
kubectl exec -it docdb-migration -c mongo8 -- bash

# Install curl
apt-get update && apt-get install -y curl

# Download mongo tools version that cna restore the dump
# See bug https://github.com/documentdb/documentdb/issues/148
curl -sO https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2404-x86_64-100.11.0.deb
apt install -y ./mongodb-database-tools-ubuntu2404-x86_64-100.11.0.deb 

# Download the Amazon DocumentDB TLS certificate bundle
curl -sO https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
mv global-bundle.pem /data/

mkdir /scripts
cp /scripts-src/* /scripts/
chmod +x /scripts/*.sh

/scripts/create-db-and-user.sh
echo $?
/scripts/restore.sh
echo $?
/scripts/verify-restore.sh
# Compare stats with the ones from the dump

# Leave the shell and exit the pod
ctrl^d
```

## Run a deployment-manager pod that connects to the new database

Update the image tag in the manifest to the version you want to test with.
Save the manifest to a file called `deployment-manager-mongov8.yaml`.
```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    app.kubernetes.io/instance: deployment-manager-mongov8
    app.kubernetes.io/name: deployment-manager-mongov8
    role: deployment-manager-security-group-role
  name: deployment-manager-mongov8
  namespace: deployment-manager
spec:
  automountServiceAccountToken: true
  containers:
  - env:
    - name: FRPS_INTERNAL_ADDRESS
      value: frps-api.frps.svc.cluster.local:7501
    - name: FRPS_INTERNAL_USE_TLS
      value: "false"
    - name: BASE_URL
      value: https://deployment-manager.k8s.dev.nos.ci
    - name: CONFIDENTIAL_BY_DEFAULT
      value: "true"
    - name: DASHBOARD_BACKEND_URL
      value: http://dashboard.dashboard.svc.cluster.local:3000
    - name: DEPLOYMENT_MANAGER_PORT
      value: "3000"
    - name: FRPS_API_URL
      value: http://frps-api.frps.svc.cluster.local:7501
    - name: NETWORK
      value: devnet
    - name: TASKS_BATCH_SIZE
      value: "50"
    - name: SOLANA_NETWORK
      value: https://api.devnet.solana.com
    - name: DOCDB_DBNAME
      value: nosana_deployment
    envFrom:
    - secretRef:
        name: deployment-manager-variable-secrets-mongov8
    image: registry.gitlab.com/nosana-ci/apps/platform/deployment-manager:edec38ac0536b5629376a2995cca3ea3e7425928
    imagePullPolicy: IfNotPresent
#    command: ["tail", "-f", "/dev/null"]
    livenessProbe:
      httpGet:
        path: /stats
        port: 3000
    name: deployment-manager
    ports:
    - containerPort: 3000
      name: http
      protocol: TCP
    readinessProbe:
      failureThreshold: 3
      periodSeconds: 10
      successThreshold: 1
      httpGet:
        path: /stats
        port: 3000
      timeoutSeconds: 1
    resources:
      limits:
        cpu: "2"
        memory: 8Gi
        vpc.amazonaws.com/pod-eni: "1"
      requests:
        cpu: "1"
        memory: 6Gi
        vpc.amazonaws.com/pod-eni: "1"
#    startupProbe:
#      failureThreshold: 30
#      periodSeconds: 5
#      successThreshold: 1
#      tcpSocket:
#        port: 3000
#      timeoutSeconds: 1
    terminationMessagePath: /dev/termination-log
    terminationMessagePolicy: File
  dnsPolicy: ClusterFirst
  enableServiceLinks: true
  imagePullSecrets:
  - name: deployment-manager-image-pull-secrets
  restartPolicy: Always
  securityContext: {}
  serviceAccountName: default
  terminationGracePeriodSeconds: 30
```

Create a secret with the new connection information.
```bash
vaultKey="$(kubectl get secret deployment-manager-variable-secrets -o json | jq -r '.data["VAULT_KEY"]' | base64 --decode)"

kubectl create secret -n deployment-manager generic deployment-manager-variable-secrets-mongov8 \
  --from-literal="DOCDB_HOST=${dstHost}" \
  --from-literal="DOCDB_PORT=${dstPort}" \
  --from-literal="DOCDB_USERNAME=${dstUsername}" \
  --from-literal="DOCDB_PASSWORD=${dstPassword}" \
  --from-literal="VAULT_KEY=${vaultKey}"
```

Run the pod and check that it becomes ready
```bash
kubectl apply -f deployment-manager-mongov8.yaml

kubectl get pods -n deployment-manager -w
```

When the pod is ready, get the logs.
```bash
kubectl -n deployment-manager logs deployment-manager-mongov8
```

If there are no unexpected errors in the log then the migration was successful.


## Cleanup

Delete pods, secrets and configmap.
```bash
# Delete validation pod
kubectl delete -f deployment-manager-mongov8.yaml --force=true
kubectl delete secret deployment-manager-variable-secrets-mongov8

# Delete migration pod
kubectl delete -f docdb-migration.yaml --force=true
kubectl delete secret docdb-migration-credentials
kubectl delete configmap docdb-migration-scripts
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
