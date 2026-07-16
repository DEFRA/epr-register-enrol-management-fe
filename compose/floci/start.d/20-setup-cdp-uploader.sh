#!/bin/bash

# Create S3 buckets and SQS queues in parallel to stay within the 30s hook timeout.
# The put-bucket-notification-configuration runs after because it depends on both
# the cdp-uploader-quarantine bucket and mock-clamav queue existing.
aws --endpoint-url=http://localhost:4566 s3 mb s3://cdp-uploader-quarantine &
aws --endpoint-url=http://localhost:4566 s3 mb s3://my-bucket &
aws --endpoint-url=http://localhost:4566 s3 mb s3://epr-register-enrol-file-uploads &
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-clamav-results &
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-uploader-scan-results-callback.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' &
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name mock-clamav &
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-uploader-download-requests &
wait

aws --endpoint-url=http://localhost:4566 s3api put-bucket-notification-configuration \
  --bucket cdp-uploader-quarantine \
  --notification-configuration '{"QueueConfigurations":[{"QueueArn":"arn:aws:sqs:eu-west-2:000000000000:mock-clamav","Events":["s3:ObjectCreated:*"]}]}'
