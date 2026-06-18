#!/bin/bash

# S3 buckets for the EPR register-enrol backend
aws --endpoint-url=http://localhost:4566 s3 mb s3://epr-register-enrol-sampling-plans
aws --endpoint-url=http://localhost:4566 s3 mb s3://epr-register-enrol-bes-evidence
