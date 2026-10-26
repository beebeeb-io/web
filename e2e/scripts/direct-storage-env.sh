#!/usr/bin/env bash
# Sourced by web-e2e.sh. Existing local MinIO only; never a provider/prod endpoint.
[[ ${BB_E2E_STORAGE:-local} == minio ]] || return 0
export S3_ENDPOINT=${E2E_MINIO_ENDPOINT:-http://127.0.0.1:9000}
export S3_BUCKET=${E2E_MINIO_BUCKET:-beebeeb-test01}
python3 - "$S3_ENDPOINT" "$S3_BUCKET" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlsplit(sys.argv[1])
assert u.scheme=='http' and u.hostname in ('127.0.0.1','localhost','::1') and not u.username and not u.password and u.path in ('','') and not u.query and not u.fragment, 'MinIO rung requires a loopback http endpoint'
assert sys.argv[2]=='beebeeb-test01', 'MinIO rung requires the dedicated test bucket'
PY
export S3_REGION=${E2E_MINIO_REGION:-eu-central-1}
# Public local-fixture values; no provider credentials are accepted by this variant.
export S3_ACCESS_KEY_ID=${E2E_MINIO_ACCESS_KEY_ID:-minioadmin}
export S3_SECRET_ACCESS_KEY=${E2E_MINIO_SECRET_ACCESS_KEY:-minioadmin}
export BB_DIRECT_DOWNLOAD=${BB_E2E_DIRECT_DOWNLOAD:-1} BB_DIRECT_UPLOAD=0 BB_DIRECT_TRANSFER_POOLS='*'
export BB_DIRECT_DISABLE=web:upload
export VITE_DEV_STORAGE_PAIR="{\"host\":\"${S3_ENDPOINT#http://}\",\"bucket\":\"$S3_BUCKET\"}"
E2E_STORAGE_ENV=(BLOB_STORE=s3)
