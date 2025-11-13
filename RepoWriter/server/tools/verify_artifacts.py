# verify_artifacts.py

import sys
import hashlib

def calculate_checksum(file_path):
    hasher = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: verify_artifacts.py <file_path> <expected_checksum>')
        sys.exit(1)

    file_path = sys.argv[1]
    expected_checksum = sys.argv[2]
    actual_checksum = calculate_checksum(file_path)

    if actual_checksum == expected_checksum:
        print('Checksum verification passed.')
    else:
        print('Checksum verification failed!')
