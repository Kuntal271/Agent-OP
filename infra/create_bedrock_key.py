"""Create/rotate the long-term Bedrock API key for the always-on Hermes.

Run with short-lived SSO creds that can manage IAM (e.g. the Bedrock-admin role) in the env:
    uv run --with boto3 python create_bedrock_key.py
Creates IAM user kuntal-hermes-bedrock (idempotent), sets an invoke-only inline policy, mints a
90-day Bedrock API key, stores it in Modal Secret kuntal-hermes-bedrock (env `main`) without ever
printing it, then proves it works with a 5-token Converse call authenticated only by the key.
"""

import json
import os
import subprocess
import sys
import time

import boto3
from botocore.exceptions import ClientError

USER = "kuntal-hermes-bedrock"
POLICY_NAME = "kuntal-hermes-bedrock-invoke"
MODEL_ID = "global.anthropic.claude-sonnet-5-5"
MODEL_PREFIX = "anthropic.claude-sonnet-5-5"
REGION = "us-east-1"
AGE_DAYS = 90
MODAL_SECRET = "kuntal-hermes-bedrock"
MODAL = os.path.expanduser("~/.local/bin/modal")


def policy(account: str) -> str:
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [
            {   # Invoke the Sonnet model only: the global inference profile + the regional/global
                # foundation-model ARNs it routes to (region `*` also matches the empty global region).
                "Sid": "InvokeSonnetOnly",
                "Effect": "Allow",
                "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                "Resource": [
                    f"arn:aws:bedrock:*:{account}:inference-profile/{MODEL_ID}*",
                    f"arn:aws:bedrock:*::foundation-model/{MODEL_PREFIX}*",
                ],
            },
            {   # Required for any API-key (bearer token) call; long-term keys only.
                "Sid": "AllowLongTermBearerToken",
                "Effect": "Allow",
                "Action": "bedrock:CallWithBearerToken",
                "Resource": "*",
                "Condition": {"StringEquals": {"bedrock:bearerTokenType": "LONG_TERM"}},
            },
        ],
    })


def verify(key: str) -> str:
    """Converse call in a clean subprocess: no SigV4 creds, only the bearer key."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("AWS_")}
    env.update(AWS_BEARER_TOKEN_BEDROCK=key, AWS_REGION=REGION)
    code = (
        "import boto3;c=boto3.client('bedrock-runtime',region_name='%s');"
        "r=c.converse(modelId='%s',messages=[{'role':'user','content':[{'text':'Reply with exactly: OK'}]}],"
        "inferenceConfig={'maxTokens':5});"
        "print(r['output']['message']['content'][0]['text'].strip(), r['usage'])" % (REGION, MODEL_ID)
    )
    last = ""
    for attempt in range(1, 9):  # new IAM principals take a few seconds to propagate
        p = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
        if p.returncode == 0:
            return f"attempt {attempt}: {p.stdout.strip()}"
        last = (p.stderr.strip().splitlines() or ["?"])[-1]
        time.sleep(8)
    raise RuntimeError(f"verification failed: {last}")


def main() -> int:
    account = boto3.client("sts").get_caller_identity()["Account"]
    iam = boto3.client("iam")

    try:
        iam.get_user(UserName=USER)
        print(f"user {USER}: exists")
    except ClientError as e:
        if e.response["Error"]["Code"] != "NoSuchEntity":
            raise
        iam.create_user(UserName=USER, Tags=[
            {"Key": "purpose", "Value": "always-on Hermes (Modal) Bedrock API key"},
            {"Key": "owner", "Value": "kuntal"},
        ])
        print(f"user {USER}: created")

    iam.put_user_policy(UserName=USER, PolicyName=POLICY_NAME, PolicyDocument=policy(account))
    print(f"inline policy {POLICY_NAME}: set (invoke {MODEL_ID} only)")

    existing = iam.list_service_specific_credentials(
        UserName=USER, ServiceName="bedrock.amazonaws.com")["ServiceSpecificCredentials"]
    for c in existing:
        print(f"existing key {c['ServiceSpecificCredentialId']} status={c['Status']} created={c['CreateDate']:%Y-%m-%d}")

    cred = iam.create_service_specific_credential(
        UserName=USER, ServiceName="bedrock.amazonaws.com", CredentialAgeDays=AGE_DAYS,
    )["ServiceSpecificCredential"]
    key, cred_id = cred["ServiceApiKeyValue"], cred["ServiceSpecificCredentialId"]
    expires = cred.get("ExpirationDate")
    print(f"new key {cred_id}: created, expires {expires:%Y-%m-%d %H:%M} UTC" if expires else f"new key {cred_id}: created")

    try:
        print("verify:", verify(key))
        p = subprocess.run(
            [MODAL, "secret", "create", "--force", MODAL_SECRET,
             f"AWS_BEARER_TOKEN_BEDROCK={key}", f"AWS_REGION={REGION}", f"HERMES_BEDROCK_MODEL={MODEL_ID}"],
            capture_output=True, text=True,
        )
        if p.returncode:
            raise RuntimeError(f"modal secret create failed: {p.stderr.strip()[-300:]}")
        print(f"modal secret {MODAL_SECRET}: stored (AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, HERMES_BEDROCK_MODEL)")
    except Exception:
        # Never leave an unstored or broken key alive.
        iam.delete_service_specific_credential(UserName=USER, ServiceSpecificCredentialId=cred_id)
        print(f"rolled back: deleted key {cred_id}")
        raise
    finally:
        del key
    return 0


if __name__ == "__main__":
    sys.exit(main())
