import os
import sys

# Ensure we can import from app
sys.path.append(os.getcwd())

try:
    from app.services.google_image import GoogleImageService, get_google_image_service
    print("✅ Successfully imported GoogleImageService")
except ImportError as e:
    print(f"❌ Failed to import GoogleImageService: {e}")
    sys.exit(1)

def test_service_initialization():
    # Mock API key for initialization test
    os.environ["GOOGLE_API_KEY"] = "fake_key"
    try:
        service = get_google_image_service()
        if service:
            print("✅ Service initialized successfully")
        else:
            print("❌ Service failed to initialize (returned None)")
    except Exception as e:
        print(f"❌ Service initialization threw exception: {e}")

if __name__ == "__main__":
    test_service_initialization()
