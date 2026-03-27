# Boto2 to Boto3 Transformation Definition

## Overview
This document provides a structured transformation definition for migrating Python applications from boto2 to boto3, based on the official AWS migration documentation.

## Entry Criteria

1. The source Python application must be using Boto 2.x
2. A complete inventory of dependencies with their versions must be available (e.g., requirements.txt, setup.py, Pipfile, poetry.lock).
3. The application's test suite or validation methods must be accessible to verify successful migration.
5. Source code must be accessible and in a version control system to track changes and allow rollback if needed.
6. Python environment management tool like venv should be available to create isolated environments for testing.


## Transformation Rules

### 1. Set up virtual environment for validation:
   - Create virtual environment for the selected Python version in /tmp directory
   - Configure dependency installation process
   - Set up environment for unit test validation


### 2. Import Transformations

| boto2 Pattern | boto3 Pattern | Type |
|---------------|---------------|------|
| `import boto` | `import boto3` | import_replacement |
| `from boto import *` | `import boto3` | import_replacement |
| `from boto.s3.connection import S3Connection` | `import boto3` | import_replacement |
| `from boto.s3.key import Key` | `import boto3` | import_replacement |
| `from boto.ec2.connection import EC2Connection` | `import boto3` | import_replacement |
| `from boto.dynamodb2.table import Table` | `import boto3` | import_replacement |

### 3. Connection Creation with Session Objects

**IMPORTANT: Always use boto3.Session() objects instead of direct boto3.resource() or boto3.client() calls to properly handle configuration and credentials.**

| boto2 Pattern | boto3 Pattern | Service |
|---------------|---------------|---------|
| `boto.connect_s3()` | `session = boto3.Session(); s3 = session.resource('s3')` | s3 |
| `boto.connect_ec2()` | `session = boto3.Session(); ec2 = session.resource('ec2')` | ec2 |
| `boto.connect_vpc()` | `session = boto3.Session(); ec2 = session.resource('ec2')` | ec2 |
| `boto.connect_dynamodb()` | `session = boto3.Session(); dynamodb = session.resource('dynamodb')` | dynamodb |
| `boto.connect_sqs()` | `session = boto3.Session(); sqs = session.resource('sqs')` | sqs |
| `boto.connect_sns()` | `session = boto3.Session(); sns = session.resource('sns')` | sns |
| `boto.connect_elastictranscoder()` | `session = boto3.Session(); client = session.client('elastictranscoder')` | elastictranscoder |

#### Connection Creation with Explicit Configuration
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `boto.connect_s3(aws_access_key_id='key', aws_secret_access_key='secret')` | `session = boto3.Session(aws_access_key_id='key', aws_secret_access_key='secret'); s3 = session.resource('s3')` | Explicit credentials via session |
| `boto.connect_ec2(region_name='us-west-2')` | `session = boto3.Session(region_name='us-west-2'); ec2 = session.resource('ec2')` | Explicit region via session |
| `boto.connect_s3(profile_name='myprofile')` | `session = boto3.Session(profile_name='myprofile'); s3 = session.resource('s3')` | Profile-based configuration |
| `boto.connect_s3(aws_access_key_id='key', aws_secret_access_key='secret', region_name='us-east-1')` | `session = boto3.Session(aws_access_key_id='key', aws_secret_access_key='secret', region_name='us-east-1'); s3 = session.resource('s3')` | Multiple parameters via session |

### 4. S3 Operations

#### Bucket Operations
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `s3_connection.create_bucket('bucket_name')` | `s3.create_bucket(Bucket='bucket_name')` | Keyword args required |
| `s3_connection.create_bucket('bucket_name', location=Location.USWest)` | `s3.create_bucket(Bucket='bucket_name', CreateBucketConfiguration={'LocationConstraint': 'us-west-1'})` | Location config changed |
| `s3_connection.get_bucket('bucket_name', validate=False)` | `s3.Bucket('bucket_name')` | No validation by default |
| `s3_connection.lookup('bucket_name')` | `s3.meta.client.head_bucket(Bucket='bucket_name')` | Requires exception handling |

#### Object Operations
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `Key('key_name')` | `s3.Object('bucket_name', 'key_name')` | Bucket name required |
| `key.set_contents_from_file('/path/file.txt')` | `s3.Object('bucket_name', 'key_name').put(Body=open('/path/file.txt', 'rb'))` | Use put() method |
| `key.set_metadata('key', 'value')` | `key.put(Metadata={'key': 'value'})` | Dict format |
| `key.get_metadata('key')` | `key.metadata['key']` | Direct access |

#### Access Control
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `bucket.set_acl('public-read')` | `bucket.Acl().put(ACL='public-read')` | Use ACL resource |
| `key.set_acl('public-read')` | `obj.Acl().put(ACL='public-read')` | Use ACL resource |

#### CORS Configuration
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `bucket.get_cors()` | `bucket.Cors()` | Returns CORS resource |
| `bucket.set_cors(config)` | `cors.put(CORSConfiguration=config)` | Use CORS resource |
| `bucket.delete_cors()` | `cors.delete()` | Use CORS resource |

### 5. EC2 Operations

#### Instance Management
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `ec2_connection.run_instances('ami_id')` | `ec2.create_instances(ImageId='ami_id', MinCount=1, MaxCount=1)` | Min/Max count required |
| `ec2_connection.stop_instances(instance_ids=ids)` | `ec2.instances.filter(InstanceIds=ids).stop()` | Use collection filtering |
| `ec2_connection.terminate_instances(instance_ids=ids)` | `ec2.instances.filter(InstanceIds=ids).terminate()` | Use collection filtering |

#### Instance Queries
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `ec2_connection.get_all_reservations(filters={'instance-state-name': 'running'})` | `ec2.instances.filter(Filters=[{'Name': 'instance-state-name', 'Values': ['running']}])` | New filter format |
| `ec2_connection.get_all_instance_statuses()` | `ec2.meta.client.describe_instance_status()['InstanceStatuses']` | Use client method |

#### EBS Operations
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `ec2_connection.create_snapshot('volume_id', 'description')` | `ec2.create_snapshot(VolumeId='volume_id', Description='description')` | Keyword args |
| `snapshot.create_volume('availability_zone')` | `ec2.create_volume(SnapshotId=snapshot.id, AvailabilityZone='availability_zone')` | Use resource method |
| `ec2_connection.attach_volume(volume.id, 'instance_id', '/dev/device')` | `ec2.Instance('instance_id').attach_volume(VolumeId=volume.id, Device='/dev/device')` | Use instance resource |
| `ec2_connection.delete_snapshot(snapshot.id)` | `snapshot.delete()` | Use resource method |

#### VPC Operations
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `vpc_connection.create_vpc('cidr_block')` | `ec2.create_vpc(CidrBlock='cidr_block')` | Use EC2 resource |
| `vpc_connection.create_subnet(vpc.id, 'cidr_block')` | `vpc.create_subnet(CidrBlock='cidr_block')` | Use VPC resource |
| `vpc_connection.create_internet_gateway()` | `ec2.create_internet_gateway()` | Use EC2 resource |
| `ec2_connection.attach_internet_gateway(gateway.id, vpc.id)` | `gateway.attach_to_vpc(VpcId=vpc.id)` | Use gateway resource |
| `ec2_connection.detach_internet_gateway(gateway.id, vpc.id)` | `gateway.detach_from_vpc(VpcId=vpc.id)` | Use gateway resource |

### 6. Iteration Patterns

| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `for bucket in s3_connection:` | `for bucket in s3.buckets.all():` | Use collection method |
| `for key in bucket:` | `for key in bucket.objects.all():` | Use collection method |
| `for reservation in reservations:` | `for instance in instances:` | Direct instance access |

### 7. Global Configuration and Session Management

#### Global Configuration Patterns
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `boto.config.get('Credentials', 'aws_access_key_id')` | `session = boto3.Session(aws_access_key_id='key')` | Use session objects |
| `boto.config.get('Credentials', 'aws_secret_access_key')` | `session = boto3.Session(aws_secret_access_key='secret')` | Use session objects |
| `boto.config.get('Boto', 'aws_access_key_id')` | `session = boto3.Session(aws_access_key_id='key')` | Use session objects |
| `boto.config.get('Boto', 'aws_secret_access_key')` | `session = boto3.Session(aws_secret_access_key='secret')` | Use session objects |
| `boto.config.get('Boto', 'region_name')` | `session = boto3.Session(region_name='region')` | Use session objects |
| `boto.config.get_value('Boto', 'region_name')` | `session = boto3.Session(region_name='region')` | Use session objects |

#### Environment Variable Configuration
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `os.environ['AWS_ACCESS_KEY_ID']` with `boto.connect_*()` | `session = boto3.Session()` then `session.resource()` | Session auto-detects env vars |
| `os.environ['AWS_SECRET_ACCESS_KEY']` with `boto.connect_*()` | `session = boto3.Session()` then `session.resource()` | Session auto-detects env vars |
| `os.environ['AWS_DEFAULT_REGION']` with `boto.connect_*()` | `session = boto3.Session()` then `session.resource()` | Session auto-detects env vars |

#### Profile-based Configuration
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `boto.config.get('profile', 'aws_access_key_id')` | `session = boto3.Session(profile_name='profile')` | Use named profiles |
| Connection with profile in config file | `session = boto3.Session(profile_name='profile_name')` | Explicit profile selection |

#### Connection Creation with Sessions
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `boto.connect_s3(aws_access_key_id='key', aws_secret_access_key='secret')` | `session = boto3.Session(aws_access_key_id='key', aws_secret_access_key='secret'); s3 = session.resource('s3')` | Use session for credentials |
| `boto.connect_ec2(region_name='us-west-2')` | `session = boto3.Session(region_name='us-west-2'); ec2 = session.resource('ec2')` | Use session for region |
| `boto.connect_s3(profile_name='myprofile')` | `session = boto3.Session(profile_name='myprofile'); s3 = session.resource('s3')` | Use session for profiles |

#### Configuration File Patterns
| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `~/.boto` config file usage | `~/.aws/credentials` and `~/.aws/config` with `boto3.Session()` | New config file format |
| `[Credentials]` section in `.boto` | `[default]` or `[profile_name]` in `.aws/credentials` | Different section format |
| `[Boto]` section in `.boto` | `[default]` or `[profile profile_name]` in `.aws/config` | Different section format |

### 8. Error Handling

| boto2 Pattern | boto3 Pattern | Notes |
|---------------|---------------|-------|
| `boto.exception.S3ResponseError` | `botocore.exceptions.ClientError` | Unified exception |
| `boto.exception.EC2ResponseError` | `botocore.exceptions.ClientError` | Unified exception |

### 9. Delete the virtual environment install in the step 1

## Implementation Steps

1. **Set up validation environment**
   - Create virtual environment for target Python version in /tmp directory
   - Configure dependency installation process
   - Set up environment for unit test validation

2. **Update Import Statements**
   - Replace all boto imports with boto3
   - Add botocore import for exception handling

3. **Update Connection Creation**
   - Replace connect_* methods with boto3.Session() objects
   - Always create a session first, then use session.resource() or session.client()
   - Choose resource for high-level operations, client for low-level
   - Pass configuration parameters (credentials, region, profile) to Session constructor

4. **Transform Method Calls**
   - Convert all parameters to keyword arguments
   - Use UpperCamelCase for parameter names

5. **Update Iteration Patterns**
   - Replace direct iteration with collection methods
   - Use .all(), .filter(), .limit() as needed

6. **Update Error Handling**
   - Replace service-specific exceptions with ClientError
   - Check error codes in exception response

7. **Update Global Configuration and Connection Creation**
   - **CRITICAL**: Replace all direct boto3.resource() and boto3.client() calls with session-based patterns
   - Replace global configuration patterns with boto3 session objects
   - Convert boto.config usage to Session constructor parameters
   - Update credential management to use sessions instead of global variables
   - Replace environment variable access with session-based configuration
   - Convert profile-based configurations to use Session(profile_name='...')
   - Ensure all AWS service connections are created through session objects

8. **Test and Validate**
   - Run validation commands to validate for syntax issues
   - Run unit tests after each module migration using pytest
   - Validate integration points between modules
   - Check for runtime deprecation warnings
   - As a final validation check, execute ALL UNIT TESTS using pytest


## Parameter Naming Convention

boto3 uses UpperCamelCase for all API parameters to match AWS service APIs:

| boto2 (snake_case) | boto3 (UpperCamelCase) |
|-------------------|------------------------|
| `instance_id` | `InstanceId` |
| `min_count` | `MinCount` |
| `max_count` | `MaxCount` |
| `volume_id` | `VolumeId` |
| `availability_zone` | `AvailabilityZone` |
| `cidr_block` | `CidrBlock` |

## Common Gotchas

1. **All parameters must be keyword arguments**
   - boto2 allowed positional arguments
   - boto3 requires all parameters to be named

2. **Session-based Connection Management**
   - Always create boto3.Session() first, then use session.resource() or session.client()
   - Resources: High-level, object-oriented (recommended) - use session.resource()
   - Clients: Low-level, direct API mapping - use session.client()
   - Sessions provide proper credential and configuration management

3. **Exception handling changes**
   - Use ClientError for all AWS service errors
   - Check error_code in response for specific errors

4. **Iteration patterns changed**
   - No direct iteration over connections
   - Use collection methods like .all(), .filter()

5. **Bucket validation removed**
   - boto2 had validate parameter
   - boto3 requires explicit head_bucket() call

## Constraints and Guardrails
  - Only run validation command that is installed in the virtual environment for the target Python version
  - Only run validation command on the root folder of the project directory
  - Make sure to setup a virtual environment, activate the environment and install all validation, test and necessary dependencies related to the application for the migration and then delete the environment once the migration is finished.
  - Make sure to run all unit tests in the project using pytest
  - Prioritize on required transformations for boto3 compatibility instead of cleaning up code
  - Keep logger statements limited to those present in the original code
  
## Validation / Exit Criteria

1. If validation command specified, migrated code passes validation command.
2. If there are unit tests, they should pass with the same or better success rate compared to the original Boto 2.x version.
3. If there are documentation, they should be updated to reflect Boto3 requirements and any API changes.
4. If there are deployment scripts, they should be updated to conform with Boto3.
5. All imports updated to boto3
6. Connection creation uses Session objects with session.resource() or session.client()
7. All method calls use keyword arguments
8. Parameter names use UpperCamelCase
9. Iteration uses collection methods
10. Error handling uses ClientError

## Example Migration

### Before (boto2)
```python
import boto
from boto.s3.key import Key
import os

# Global configuration
os.environ['AWS_ACCESS_KEY_ID'] = 'your_key'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'your_secret'

# Create connection with global config
s3_connection = boto.connect_s3()

# Create bucket
s3_connection.create_bucket('my-bucket')

# Upload file
key = Key('my-file.txt')
key.set_contents_from_file('/tmp/file.txt')

# List buckets
for bucket in s3_connection:
    print(bucket.name)
```

### After (boto3)
```python
import boto3
import botocore

# Create session with explicit configuration
session = boto3.Session(
    aws_access_key_id='your_key',
    aws_secret_access_key='your_secret',
    region_name='us-east-1'
)

# Create resource using session
s3 = session.resource('s3')

# Create bucket
s3.create_bucket(Bucket='my-bucket')

# Upload file
s3.Object('my-bucket', 'my-file.txt').put(Body=open('/tmp/file.txt', 'rb'))

# List buckets
for bucket in s3.buckets.all():
    print(bucket.name)
```

### Configuration File Migration Example

#### Before (boto2) - ~/.boto
```ini
[Credentials]
aws_access_key_id = your_key
aws_secret_access_key = your_secret

[Boto]
region_name = us-west-2
```

#### After (boto3) - ~/.aws/credentials and ~/.aws/config
```ini
# ~/.aws/credentials
[default]
aws_access_key_id = your_key
aws_secret_access_key = your_secret

# ~/.aws/config
[default]
region = us-west-2
```

```python
# Code using the configuration
session = boto3.Session()  # Automatically uses default profile
s3 = session.resource('s3')
```

This transformation definition provides a comprehensive guide for migrating from boto2 to boto3, covering the most common patterns and operations across AWS services.
