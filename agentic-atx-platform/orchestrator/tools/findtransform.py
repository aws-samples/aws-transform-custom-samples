"""
FindTransform Sub-Agent

Discovers the best matching AWS-managed transformation
by searching and listing the available catalog.
"""

import os
import json
import logging
import boto3
from typing import Any, Dict

from strands import Agent, tool

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MANAGED_TRANSFORMATIONS = [
    {'name': 'AWS/python-version-upgrade', 'language': 'python', 'description': 'Upgrade Python applications from 3.8/3.9 to 3.11/3.12/3.13', 'tags': ['python', 'upgrade', 'migration']},
    {'name': 'AWS/java-version-upgrade', 'language': 'java', 'description': 'Upgrade Java applications from any source JDK to any target JDK', 'tags': ['java', 'upgrade', 'migration']},
    {'name': 'AWS/nodejs-version-upgrade', 'language': 'nodejs', 'description': 'Upgrade Node.js applications from any source to any target version', 'tags': ['nodejs', 'javascript', 'upgrade', 'migration']},
    {'name': 'AWS/python-boto2-to-boto3', 'language': 'python', 'description': 'Migrate Python applications from boto2 to boto3', 'tags': ['python', 'aws', 'sdk', 'migration', 'boto']},
    {'name': 'AWS/java-aws-sdk-v1-to-v2', 'language': 'java', 'description': 'Upgrade AWS SDK from v1 to v2 for Java (Maven or Gradle)', 'tags': ['java', 'aws', 'sdk', 'migration']},
    {'name': 'AWS/nodejs-aws-sdk-v2-to-v3', 'language': 'nodejs', 'description': 'Upgrade Node.js from AWS SDK v2 to v3 modular architecture', 'tags': ['nodejs', 'javascript', 'aws', 'sdk', 'migration']},
    {'name': 'AWS/early-access-comprehensive-codebase-analysis', 'language': 'all', 'description': 'Deep static analysis with technical debt, security, and modernization insights', 'tags': ['analysis', 'security', 'modernization']},
    {'name': 'AWS/early-access-java-x86-to-graviton', 'language': 'java', 'description': 'Validate and migrate Java applications to ARM64 for AWS Graviton', 'tags': ['java', 'graviton', 'arm64', 'migration']},
    {'name': 'AWS/early-access-angular-to-react-migration', 'language': 'nodejs', 'description': 'Transform Angular applications to React', 'tags': ['angular', 'react', 'javascript', 'migration']},
    {'name': 'AWS/early-access-jfr-performance-optimization', 'language': 'java', 'description': 'Optimize Java performance using JFR profiling data', 'tags': ['java', 'performance', 'jfr', 'optimization']},
]


@tool
def search_transformations(query: str, language: str = "") -> Dict[str, Any]:
    """Search transformations by keyword or language.

    Args:
        query: Search keyword (e.g., 'sdk', 'upgrade', 'migration')
        language: Optional language filter (python, java, nodejs)
    """
    q = query.lower()
    lang = language.lower() if language else ""
    results = [t for t in MANAGED_TRANSFORMATIONS
               if (q in t['name'].lower() or q in t['description'].lower() or any(q in tag for tag in t['tags']))
               and (not lang or lang in t['language'] or t['language'] == 'all')]
    return {"status": "success", "result_count": len(results), "results": results}


@tool
def list_transformations(language: str = "all") -> Dict[str, Any]:
    """List all available code transformations.

    Args:
        language: Filter by language (python, java, nodejs, or all)
    """
    filtered = MANAGED_TRANSFORMATIONS if language == "all" else [t for t in MANAGED_TRANSFORMATIONS if t['language'] == language.lower() or t['language'] == 'all']
    return {"status": "success", "transformation_count": len(filtered), "transformations": filtered}


@tool
def list_published_custom() -> Dict[str, Any]:
    """List custom transformations that have been published to the ATX registry.

    Returns:
        Dictionary with published custom transformation names
    """
    try:
        account = boto3.client('sts').get_caller_identity()['Account']
        bucket = f"atx-source-code-{account}"
        s3 = boto3.client('s3', region_name=os.getenv("AWS_REGION", "us-east-1"))
        paginator = s3.get_paginator('list_objects_v2')
        published = []
        for page in paginator.paginate(Bucket=bucket, Prefix='custom-definitions/', Delimiter='/'):
            for prefix in page.get('CommonPrefixes', []):
                name = prefix['Prefix'].replace('custom-definitions/', '').rstrip('/')
                if not name:
                    continue
                try:
                    obj = s3.get_object(Bucket=bucket, Key=f'custom-definitions/{name}/status.json')
                    status = json.loads(obj['Body'].read().decode('utf-8'))
                    if status.get('status') == 'published':
                        published.append({'name': name, 'description': status.get('description', '')})
                except Exception:
                    pass
        return {"status": "success", "published_custom": published, "count": len(published)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def find_transform_agent(query: str, language: str = "") -> Dict[str, Any]:
    """Finds the best matching AWS-managed transformation for an application's needs.

    Args:
        query: Description of the application and requirements
        language: Optional language filter (python, java, nodejs)
    """
    logger.info("FIND TRANSFORM AGENT INVOKED")

    # Use direct Bedrock call to reason about the best match (avoids Strands streaming bug)
    try:
        # Get all available transformations
        managed = list_transformations(language=language or "all")
        custom = list_published_custom()

        all_transforms = []
        for t in managed.get('transformations', []):
            all_transforms.append(f"- {t['name']}: {t['description']} (language: {t['language']})")
        for c in custom.get('published_custom', []):
            all_transforms.append(f"- {c['name']}: {c.get('description', 'Custom transformation')} (custom)")

        if not all_transforms:
            return {"status": "success", "result": "No transformations available."}

        bedrock_rt = boto3.client('bedrock-runtime', region_name=os.getenv("AWS_REGION", "us-east-1"))
        select_prompt = f"""Given these available transformations and the user's requirements, select the BEST matching transformation.
Return ONLY valid JSON with: {{"name": "transformation-name", "reason": "why this is the best match"}}
If no transformation matches, return: {{"name": "", "reason": "No matching transformation found"}}

User requirements: {query}
Language: {language or 'Not specified'}

Available transformations:
{chr(10).join(all_transforms)}"""

        response = bedrock_rt.invoke_model(
            modelId=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"),
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048, "temperature": 0.1,
                "messages": [{"role": "user", "content": select_prompt}]
            })
        )
        raw_text = json.loads(response['body'].read())['content'][0]['text'].strip()
        if '```' in raw_text:
            raw_text = raw_text.split('```')[1]
            if raw_text.startswith('json'): raw_text = raw_text[4:]
            raw_text = raw_text.strip()
        result = json.loads(raw_text)

        name = result.get('name', '')
        reason = result.get('reason', '')

        if name:
            return {"status": "success", "result": f"Best match: {name}. {reason}"}
        else:
            return {"status": "success", "result": f"No matching transformation found. {reason}"}

    except Exception as e:
        logger.error(f"Find transform agent failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
