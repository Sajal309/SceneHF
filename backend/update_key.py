
import os

KEY = "AIzaSyC6M3Te9iEpbh4-Ow_eXpCz_2fnJuwV0qs"
ENV_PATH = ".env"

def update_env():
    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r") as f:
            lines = f.readlines()
    
    new_lines = []
    key_found = False
    for line in lines:
        if line.startswith("GOOGLE_API_KEY=") or line.startswith("GEMINI_API_KEY="):
            # Comment out old key
            new_lines.append(f"# {line}")
            key_found = True
        else:
            new_lines.append(line)
    
    # Append the new key if not strictly replacing (or just append a fresh one at end)
    # Actually, let's just add the GOOGLE_API_KEY
    new_lines.append(f"\nGOOGLE_API_KEY={KEY}\n")
    
    with open(ENV_PATH, "w") as f:
        f.writelines(new_lines)
    print("✅ backend/.env updated with new API key from user prompt.")

if __name__ == "__main__":
    update_env()
