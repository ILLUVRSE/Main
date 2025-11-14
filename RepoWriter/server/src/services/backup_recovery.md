# Backup & Recovery
## Overview
This document outlines the procedures for backing up and restoring data for both Postgres and Vector DB. It also details the validation of the replay procedure from audit archives.
## Backup Procedures
### Postgres
- Ensure that the database is in a consistent state before initiating a backup.
### Vector DB
- Follow the specific backup procedures for the Vector DB.
## Restore Procedures
### Postgres
- Steps to restore from a backup.
### Vector DB
- Steps to restore from a backup.
## Backup & DR
Tested backups and recovery for Postgres, Vector DB, and Audit archives. Runbook for rebuild from audit archives exists.