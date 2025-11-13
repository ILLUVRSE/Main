#!/bin/bash

# Wait for services to start
sleep 10

# Run smoke tests
curl -f http://localhost:3000/api/validate -d '{"patches": []}'
