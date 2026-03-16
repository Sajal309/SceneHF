import unittest
from unittest.mock import MagicMock, patch
import os
import sys

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.google_image import GoogleImageService, get_google_image_service

class TestGoogleImageService(unittest.TestCase):
    
    @patch('app.services.google_image.genai')
    def test_service_initialization(self, mock_genai):
        os.environ['GOOGLE_API_KEY'] = 'test-key'
        service = GoogleImageService()
        self.assertEqual(service.default_model, "gemini-2.5-flash-image")
        mock_genai.Client.assert_called_once_with(api_key='test-key')

    @patch('app.services.google_image.genai')
    @patch('app.services.google_image.Image.open')
    def test_extract_calls_generate(self, mock_image_open, mock_genai):
        os.environ['GOOGLE_API_KEY'] = 'test-key'
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        service = GoogleImageService()
        mock_input_img = MagicMock()
        mock_image_open.return_value = mock_input_img

        mock_response = MagicMock()
        mock_part = MagicMock()
        mock_part.inline_data = object()
        mock_output_img = MagicMock()
        mock_part.as_image.return_value = mock_output_img
        mock_response.parts = [mock_part]
        mock_client.models.generate_content.return_value = mock_response

        path = service.extract("input.png", "extract cat", "output.png")
        self.assertEqual(path, "output.png")
        mock_client.models.generate_content.assert_called_once()
        mock_output_img.save.assert_called_once_with("output.png")

if __name__ == '__main__':
    unittest.main()
