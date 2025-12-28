from pathlib import Path
from typing import Dict, Tuple
from PIL import Image
import numpy as np

from app.models.schemas import ValidationResult, StepStatus


class Validator:
    """Validates step outputs based on metrics."""
    
    def __init__(self):
        self.white_threshold = 250  # RGB values >= this are considered white
    
    def validate_extraction(
        self,
        image_path: str,
        source_image_path: str,
        validation_rules: Dict[str, float]
    ) -> ValidationResult:
        """
        Validate an extraction output (white background expected).
        
        Args:
            image_path: Path to output image
            source_image_path: Path to source image (for size comparison)
            validation_rules: Dict with min_nonwhite, max_nonwhite, etc.
        
        Returns:
            ValidationResult with status and metrics
        """
        try:
            img = Image.open(image_path).convert('RGB')
            source_img = Image.open(source_image_path)
            
            metrics = {}
            notes = []
            
            # Check size match
            if img.size != source_img.size:
                return ValidationResult(
                    passed=False,
                    status=StepStatus.FAILED,
                    metrics={"size_match": 0.0},
                    notes=f"Size mismatch: {img.size} vs {source_img.size}"
                )
            
            metrics["size_match"] = 1.0
            
            # Calculate nonwhite ratio
            img_array = np.array(img)
            is_white = np.all(img_array >= self.white_threshold, axis=2)
            total_pixels = img_array.shape[0] * img_array.shape[1]
            nonwhite_pixels = np.sum(~is_white)
            nonwhite_ratio = nonwhite_pixels / total_pixels
            
            metrics["nonwhite_ratio"] = float(nonwhite_ratio)
            
            # White purity check (are near-whites actually white?)
            near_white = np.all(img_array >= 240, axis=2) & ~is_white
            near_white_ratio = np.sum(near_white) / total_pixels
            metrics["white_purity"] = 1.0 - float(near_white_ratio)
            
            # Band checks (top/bottom)
            height = img_array.shape[0]
            top_band = img_array[:height//4, :]
            bottom_band = img_array[3*height//4:, :]
            
            top_nonwhite = np.sum(~np.all(top_band >= self.white_threshold, axis=2))
            bottom_nonwhite = np.sum(~np.all(bottom_band >= self.white_threshold, axis=2))
            
            metrics["top_band_nonwhite"] = float(top_nonwhite / (top_band.shape[0] * top_band.shape[1]))
            metrics["bottom_band_nonwhite"] = float(bottom_nonwhite / (bottom_band.shape[0] * bottom_band.shape[1]))
            
            # Decision logic
            min_nonwhite = validation_rules.get("min_nonwhite", 0.01)
            max_nonwhite = validation_rules.get("max_nonwhite", 0.5)
            
            if nonwhite_ratio < min_nonwhite:
                # Too empty
                return ValidationResult(
                    passed=False,
                    status=StepStatus.FAILED,
                    metrics=metrics,
                    notes=f"Output too empty ({nonwhite_ratio:.2%} content, expected >{min_nonwhite:.2%})"
                )
            
            if nonwhite_ratio > max_nonwhite:
                # Too much content (might have extracted too much)
                notes.append(f"High content ratio ({nonwhite_ratio:.2%})")
                return ValidationResult(
                    passed=True,
                    status=StepStatus.NEEDS_REVIEW,
                    metrics=metrics,
                    notes="; ".join(notes)
                )
            
            # Check white purity
            if metrics["white_purity"] < 0.95:
                notes.append(f"White purity low ({metrics['white_purity']:.2%})")
                return ValidationResult(
                    passed=True,
                    status=StepStatus.NEEDS_REVIEW,
                    metrics=metrics,
                    notes="; ".join(notes)
                )
            
            # All good
            return ValidationResult(
                passed=True,
                status=StepStatus.SUCCESS,
                metrics=metrics,
                notes="Validation passed"
            )
            
        except Exception as e:
            return ValidationResult(
                passed=False,
                status=StepStatus.FAILED,
                metrics={},
                notes=f"Validation error: {str(e)}"
            )
    
    def validate_plate(
        self,
        image_path: str,
        source_image_path: str,
        validation_rules: Dict[str, float]
    ) -> ValidationResult:
        """
        Validate a plate/removal output (should have substantial content).
        
        Args:
            image_path: Path to output image
            source_image_path: Path to source image
            validation_rules: Dict with min_nonwhite, etc.
        
        Returns:
            ValidationResult with status and metrics
        """
        try:
            img = Image.open(image_path).convert('RGB')
            source_img = Image.open(source_image_path)
            
            metrics = {}
            
            # Check size match
            if img.size != source_img.size:
                return ValidationResult(
                    passed=False,
                    status=StepStatus.FAILED,
                    metrics={"size_match": 0.0},
                    notes=f"Size mismatch: {img.size} vs {source_img.size}"
                )
            
            metrics["size_match"] = 1.0
            
            # Calculate nonwhite ratio
            img_array = np.array(img)
            is_white = np.all(img_array >= self.white_threshold, axis=2)
            total_pixels = img_array.shape[0] * img_array.shape[1]
            nonwhite_pixels = np.sum(~is_white)
            nonwhite_ratio = nonwhite_pixels / total_pixels
            
            metrics["nonwhite_ratio"] = float(nonwhite_ratio)
            
            # For plates, we expect substantial content
            min_nonwhite = validation_rules.get("min_nonwhite", 0.2)
            
            if nonwhite_ratio < min_nonwhite:
                return ValidationResult(
                    passed=False,
                    status=StepStatus.FAILED,
                    metrics=metrics,
                    notes=f"Plate too empty ({nonwhite_ratio:.2%}, expected >{min_nonwhite:.2%})"
                )
            
            # Success
            return ValidationResult(
                passed=True,
                status=StepStatus.SUCCESS,
                metrics=metrics,
                notes="Plate validation passed"
            )
            
        except Exception as e:
            return ValidationResult(
                passed=False,
                status=StepStatus.FAILED,
                metrics={},
                notes=f"Validation error: {str(e)}"
            )


# Global validator instance
validator = Validator()
