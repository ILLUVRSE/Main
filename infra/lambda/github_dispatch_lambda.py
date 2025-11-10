import os
import json
import boto3
import urllib.request
import urllib.error
import base64
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_github_pat(secret_name):
    sm = boto3.client('secretsmanager')
    resp = sm.get_secret_value(SecretId=secret_name)
    if 'SecretString' in resp and resp['SecretString']:
        return resp['SecretString']
    if 'SecretBinary' in resp and resp['SecretBinary']:
        return base64.b64decode(resp['SecretBinary']).decode('utf-8')
    raise RuntimeError("Secret had no SecretString or SecretBinary")

def extract_key_arn(event):
    # CloudTrail style: event['detail']['responseElements']['keyMetadata']['arn']
    try:
        detail = event.get('detail', {}) or {}
        re = detail.get('responseElements', {}) or {}
        if re:
            km = re.get('keyMetadata', {}) or {}
            if km.get('arn'):
                return km.get('arn')
    except Exception:
        pass
    # repository_dispatch style payload forwarded via repository_dispatch client_payload
    try:
        detail = event.get('detail', {}) or {}
        cp = detail.get('client_payload', {}) or {}
        if cp.get('keyArn'):
            return cp.get('keyArn')
    except Exception:
        pass
    # fallback top-level keys
    for k in ('keyArn','KeyArn','key_arn','arn'):
        if event.get(k):
            return event.get(k)
    # last attempt: nested detail.keyArn
    try:
        if detail.get('keyArn'):
            return detail.get('keyArn')
    except Exception:
        pass
    return None

def post_repo_dispatch(owner, repo, token, key_arn):
    url = f"https://api.github.com/repos/{owner}/{repo}/dispatches"
    payload = {
        "event_type": "kms-key-rotation",
        "client_payload": {"keyArn": key_arn}
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'token {token}')
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            # some endpoints return empty body on success
            try:
                body = resp.read().decode('utf-8')
            except Exception:
                body = ''
            logger.info("GitHub dispatch success: %s %s", resp.status, body)
            return {"status": resp.status, "body": body}
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8')
        except Exception:
            err_body = ""
        logger.error("GitHub dispatch HTTPError %s: %s", e.code, err_body)
        raise
    except Exception as e:
        logger.exception("Error posting to GitHub")
        raise

def lambda_handler(event, context):
    logger.info("Received event: %s", json.dumps(event))
    secret_name = os.environ.get('SECRET_NAME') or os.environ.get('GITHUB_SECRET_NAME')
    if not secret_name:
        raise RuntimeError("SECRET_NAME environment variable must be set")
    owner = os.environ.get('REPO_OWNER', 'ILLUVRSE')
    repo = os.environ.get('REPO_NAME', 'Main')

    token = get_github_pat(secret_name)
    key_arn = extract_key_arn(event)
    if not key_arn:
        logger.error("No keyArn found in event: %s", json.dumps(event))
        raise RuntimeError("No keyArn found in event")

    # Post repository_dispatch to GitHub
    result = post_repo_dispatch(owner, repo, token, key_arn)
    return {
        "statusCode": 200,
        "body": json.dumps({"dispatched": True, "github_status": result})
    }

