import { useState, useRef } from 'react';

interface UploadCardProps {
    onUpload: (file: File) => void;
    uploading: boolean;
    error: string | null;
}

export function UploadCard({ onUpload, uploading, error }: UploadCardProps) {
    const [dragActive, setDragActive] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);

        // Upload
        onUpload(file);
    };

    const handleClick = () => {
        inputRef.current?.click();
    };

    return (
        <div className="card p-8">
            <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-all ${dragActive
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-slate-600 hover:border-slate-500'
                    }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={handleClick}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleChange}
                    className="hidden"
                />

                {preview ? (
                    <div className="space-y-4">
                        <img
                            src={preview}
                            alt="Preview"
                            className="max-h-64 mx-auto rounded-lg"
                        />
                        {uploading && (
                            <div className="text-primary-400 font-medium">Uploading...</div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-6xl">📸</div>
                        <div>
                            <p className="text-white text-lg font-medium mb-2">
                                Drop your background image here
                            </p>
                            <p className="text-slate-400 text-sm">
                                or click to browse
                            </p>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="mt-4 text-red-400 text-sm">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
