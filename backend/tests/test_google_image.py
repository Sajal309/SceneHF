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
        mock_genai.configure.assert_called_once_with(api_key='test-key')

    @patch('app.services.google_image.genai')
    @patch('app.services.google_image.Image')
    def test_extract_calls_generate(self, mock_image, mock_genai):
        os.environ['GOOGLE_API_KEY'] = 'test-key'
        service = GoogleImageService()
        
        mock_model = MagicMock()
        mock_genai.GenerativeModel.return_value = mock_model
        
        # Mock response with image data
        mock_response = MagicMock()
        mock_part = MagicMock()
        mock_part.inline_data.data = b'fake-image-data'
        mock_response.candidates[0].content.parts = [mock_part]
        mock_model.generate_content.return_value = mock_response
        
        with patch('builtins.open', unittest.mock.mock_open()) as mock_file:
            path = service.extract("input.png", "extract cat", "output.png")
            self.assertEqual(path, "output.png")
            mock_model.generate_content.assert_called()
            mock_file().write.assert_called_with(b'fake-image-data')

if __name__ == '__main__':
    unittest.main()
