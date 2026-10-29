# AWS deployment status

**Status: not implemented or tested.** This repository currently targets a local Windows/Node.js run using SQLite. It does not ship an AWS database adapter, configured DynamoDB tables, IAM roles, infrastructure definitions, or a tested Lambda/API Gateway deployment.

Do not treat the local SQLite file as durable/shared Lambda storage. A future AWS implementation should introduce an explicit repository interface and a DynamoDB-backed adapter, model partition/sort keys and conditional writes, provision least-privilege IAM and infrastructure, configure authentication/authorization, and test concurrency and failure behavior in a real AWS environment. Credentials and cloud infrastructure are not included in this project.
