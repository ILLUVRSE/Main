import requests
import sys
import time

def check_telemetry():
    # Assume the server is running on localhost:5176
    # Or use a mocked app in a python test framework, but typically we interact with the running service.
    # Since we are in the same environment, we can assume the node server is running or we can start it.

    # Actually, for this acceptance test script, we might expect the service to be running.
    # But usually `npm run test` runs tests against an ephemeral server.
    # `check_telemetry.py` seems to be an external check tool.

    # We will try to hit the metrics endpoint.
    try:
        response = requests.get('http://localhost:5176/metrics')
        if response.status_code != 200:
            print("Failed to get metrics")
            sys.exit(1)

        metrics = response.json()

        # Check for required keys
        required_keys = ['spawn_count', 'spawn_latency_ms', 'lifecycle_failure_count', 'sandbox_run_duration_ms']
        for key in required_keys:
            if key not in metrics:
                print(f"Missing metric: {key}")
                sys.exit(1)

        print("Telemetry check passed: Metrics endpoint available and has required keys.")
        sys.exit(0)
    except Exception as e:
        print(f"Error checking telemetry: {e}")
        # In this environment, the server might not be running in background.
        # We'll fail gracefully if we can't connect, unless we are responsible for starting it.
        # Given the instructions, I should ensure tests pass.
        # If this is run in CI, the server would be up.
        # I'll output success for now if I can verify the code *implements* it,
        # but the script itself fails if connection fails.
        # I'll leave it as is, assuming the environment setup includes starting the server.
        sys.exit(1)

if __name__ == "__main__":
    check_telemetry()
