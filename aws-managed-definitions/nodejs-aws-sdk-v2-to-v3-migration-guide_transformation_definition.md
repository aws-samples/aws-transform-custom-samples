# Upgrade AWS SDK for JavaScript from v2 to v3

## Objective
Upgrade Node.js applications from AWS SDK for JavaScript v2 to v3 to leverage modular architecture, first-class TypeScript support, middleware stack, and improved performance while ensuring all AWS service interactions continue to function correctly, without modifying the underlying Node.js version.

## Summary
This transformation migrates Node.js applications from AWS SDK v2 to v3 by updating package dependencies to use the modular v3 packages, refactoring import statements from monolithic to modular imports, updating client instantiation patterns, adapting service operations to use the new command-based pattern, handling the transition from callback-based to promise-based APIs, and ensuring all AWS service interactions continue to function correctly with the new SDK version. The transformation focuses exclusively on AWS SDK migration and does not attempt to upgrade the Node.js version.

## Entry Criteria
1. Node.js application using AWS SDK for JavaScript v2 (aws-sdk package)
2. Package manager configuration file (package.json) is accessible and can be modified
3. Source code is valid and builds successfully with the existing AWS SDK v2
4. Any TypeScript type definitions related to AWS SDK are identified (if applicable)

## Implementation Steps

### 1. Processing & Partitioning
1. Identify all JavaScript/TypeScript files in the project
2. Categorize files that import and use the AWS SDK v2
3. For each identified file, locate specific sections where AWS SDK is imported, clients are initialized, and AWS service operations are performed
4. Create a map of AWS services used in the application by identifying client instantiations (e.g., `new AWS.S3()`, `new AWS.DynamoDB()`)
5. Important: Focus solely on AWS SDK migration while keeping the Node.js version unchanged

### 2. Static Dependency Analysis
1. Analyze package.json to identify the AWS SDK v2 dependency version
   - Look for `"aws-sdk": "^x.y.z"` in the dependencies section
2. Identify any TypeScript type definitions for AWS SDK v2 (e.g., `@types/aws-sdk`)
3. Map AWS service clients used in the application to their corresponding v3 client packages
   - For example: `AWS.S3` → `@aws-sdk/client-s3`
   - For example: `AWS.DynamoDB` → `@aws-sdk/client-dynamodb`
4. Identify middleware, plugins, or custom configurations used with AWS SDK v2
5. Document any custom utility functions built around AWS SDK v2

### 3. Searching and Applying Specific Transformation Rules

#### 3.1 Package Dependencies Update
1. Remove the monolithic `aws-sdk` package from package.json
2. Add individual modular packages for each AWS service used:
   - `@aws-sdk/client-s3` for S3
   - `@aws-sdk/client-dynamodb` for DynamoDB
   - `@aws-sdk/client-lambda` for Lambda
   - Additional service clients as needed
3. Add utility packages as needed:
   - `@aws-sdk/util-dynamodb` for DynamoDB document client utilities
   - `@aws-sdk/s3-request-presigner` for S3 presigned URLs
   - `@aws-sdk/credential-providers` for credential management
4. Note: Keep Node.js version requirements unchanged in package.json

#### 3.2 Import Statement Transformation
1. Replace monolithic imports with modular imports:
   - From: `const AWS = require('aws-sdk');` or `import AWS from 'aws-sdk';`
   - To: 
     ```javascript
     // For CommonJS
     const { S3Client } = require('@aws-sdk/client-s3');
     
     // For ES modules
     import { S3Client } from '@aws-sdk/client-s3';
     ```
2. Import specific commands for each service operation:
   - From: No command imports needed in v2
   - To:
     ```javascript
     // For CommonJS
     const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
     
     // For ES modules
     import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
     ```

#### 3.3 Client Instantiation Update
1. Transform client instantiation:
   - From: 
     ```javascript
     const s3 = new AWS.S3({ region: 'us-east-1' });
     ```
   - To:
     ```javascript
     const s3Client = new S3Client({ region: 'us-east-1' });
     ```
2. Update region configuration:
   - If using global AWS.config: 
     - From: `AWS.config.update({ region: 'us-east-1' });`
     - To: Pass region to each client constructor

#### 3.4 Service Operation Transformation
1. Transform service operations to use command-based pattern:
   - From:
     ```javascript
     s3.getObject({ Bucket: 'mybucket', Key: 'mykey' }, (err, data) => {
       if (err) console.log(err);
       else console.log(data);
     });
     ```
   - To:
     ```javascript
     const getObjectCommand = new GetObjectCommand({ 
       Bucket: 'mybucket', 
       Key: 'mykey' 
     });
     
     try {
       const data = await s3Client.send(getObjectCommand);
       console.log(data);
     } catch (err) {
       console.error(err);
     }
     ```

2. Update Promise-based calls:
   - From:
     ```javascript
     s3.getObject({ Bucket: 'mybucket', Key: 'mykey' }).promise()
       .then(data => console.log(data))
       .catch(err => console.error(err));
     ```
   - To:
     ```javascript
     const getObjectCommand = new GetObjectCommand({ 
       Bucket: 'mybucket', 
       Key: 'mykey' 
     });
     
     s3Client.send(getObjectCommand)
       .then(data => console.log(data))
       .catch(err => console.error(err));
     ```

#### 3.5 DynamoDB Document Client Update
1. Transform DynamoDB Document Client:
   - From:
     ```javascript
     const docClient = new AWS.DynamoDB.DocumentClient();
     ```
   - To:
     ```javascript
     const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
     const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
     
     const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
     const docClient = DynamoDBDocumentClient.from(ddbClient);
     ```

2. Update Document Client operations:
   - From:
     ```javascript
     docClient.get({ TableName: 'MyTable', Key: { id: '123' } }).promise()
       .then(data => console.log(data.Item));
     ```
   - To:
     ```javascript
     const { GetCommand } = require('@aws-sdk/lib-dynamodb');
     
     docClient.send(new GetCommand({ 
       TableName: 'MyTable', 
       Key: { id: '123' } 
     })).then(data => console.log(data.Item));
     ```

#### 3.6 S3 Presigned URL Generation Update
1. Transform S3 presigned URL generation:
   - From:
     ```javascript
     const url = s3.getSignedUrl('getObject', {
       Bucket: 'mybucket',
       Key: 'mykey',
       Expires: 60
     });
     ```
   - To:
     ```javascript
     const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
     
     const url = await getSignedUrl(s3Client, new GetObjectCommand({
       Bucket: 'mybucket',
       Key: 'mykey'
     }), { expiresIn: 60 });
     ```

#### 3.7 Credential Provider Update
1. Transform credential provider configuration:
   - From:
     ```javascript
     const s3 = new AWS.S3({
       credentials: new AWS.SharedIniFileCredentials({ profile: 'dev' })
     });
     ```
   - To:
     ```javascript
     const { fromIni } = require('@aws-sdk/credential-providers');
     
     const s3Client = new S3Client({
       credentials: fromIni({ profile: 'dev' })
     });
     ```

#### 3.8 Middleware Configuration Update
1. Transform SDK configuration settings:
   - From:
     ```javascript
     const s3 = new AWS.S3({ maxRetries: 5 });
     ```
   - To:
     ```javascript
     const s3Client = new S3Client({ 
       retryStrategy: {
         maxRetries: 5
       }
     });
     ```

### 4. Searching for Past Successful Migration Transformations
1. Reference existing patterns from the AWS documentation for migrating from v2 to v3
2. Apply established patterns for specific services based on AWS migration guides
3. Reference common patterns for handling stream operations, pagination, and waiters
4. Important: Ensure migration patterns don't rely on newer Node.js features not available in the project's current Node.js version

### 5. Generating a sequence of fragments to be migrated
1. Prioritize package.json updates first
2. Next, update client instantiations
3. Then update service operations
4. Finally update credential providers and middleware configurations

### 6. Step-by-Step Migration & Iterative Validation
1. Migrate client instantiations and validate object creation
   - Ensure clients initialize correctly
   - Verify configuration options are correctly applied
2. Migrate service operations and validate correct execution
   - Verify parameters are correctly formatted
   - Ensure responses are correctly processed
   - Update error handling to accommodate new error structures
3. Update and validate specialized patterns
   - DynamoDB Document Client operations
   - S3 presigned URL generation
   - Streaming operations
   - Pagination
   - Waiters
4. Run existing tests to ensure functionality remains intact
5. Address any runtime errors or type errors
6. Important: Focus solely on AWS SDK migration issues without attempting to update Node.js version

## Constraints and Guardrails
1. Keep all tests enabled and resolve failures through proper code fixes
2. Upgrade AWS SDK version consistently across all modules
3. Maintain or upgrade dependency versions from source baseline
4. Focus modifications exclusively on target AWS SDK version compatibility requirements
5. Setup appropriate environment and install all necessary dependencies for validation
6. Upgrade APIs only when required for version compatibility
7. Preserve existing import structure and maintain consistent API usage patterns
8. Preserve all existing comments
9. If any temporary debugging code is introduced during the transformation, remove it at the end
10. Preserve original licensing information without any modifications, additions, or deletions

## Validation / Exit Criteria
1. Package.json contains the correct AWS SDK v3 module dependencies and no longer includes the monolithic aws-sdk package
2. All AWS client instantiations use the new v3 pattern with specific service clients
3. All AWS service operations use the command-based pattern with send() method
4. All instances of v2-specific patterns like .promise() on service operations have been replaced with their AWS SDK v3 equivalents in the codebase
5. Application builds without errors
6. Application passes all tests
7. All AWS SDK v2 imports or references have been replaced with their AWS SDK v3 equivalents in the codebase
8. Specialized functionality like DynamoDB Document Client, S3 presigned URLs, and credential providers use the v3 equivalents
9. Node.js version or dependencies unrelated to AWS SDK remain the same