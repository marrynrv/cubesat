import base64

SECRET_KEY = "ASTRA_2026_KEY"
INPUT_FILE = "ASTRA.sec"
OUTPUT_FILE = "ASTRA.csv"

def xor_decrypt(data_bytes, key):
    key_bytes = key.encode('utf-8')
    decrypted = bytearray()
    for i, b in enumerate(data_bytes):
        decrypted.append(b ^ key_bytes[i % len(key_bytes)])
    return decrypted

def process_file():
    try:
        count = 0
        errors = 0

        print(f"Reading {INPUT_FILE} and decrypting...")

        with open(INPUT_FILE, "r", encoding="utf-8") as f_in, \
             open(OUTPUT_FILE, "w", encoding="utf-8-sig") as f_out:
            
            for line in f_in:
                line = line.strip()
                if not line:
                    continue
                try:
                    # 1. Base64 Decoding
                    encrypted_bytes = base64.b64decode(line)
                    # 2. XOR Decryption
                    decrypted_bytes = xor_decrypt(encrypted_bytes, SECRET_KEY)
                    # 3. UTF-8 Decoding
                    decrypted_text = decrypted_bytes.decode('utf-8', errors='ignore')
                    
                    # Writing to CSV file
                    f_out.write(decrypted_text + "\n")
                    count += 1
                except Exception:
                    errors += 1

        print(f"Done! Processed lines: {count} (errors: {errors})")
        print(f"Result saved to: {OUTPUT_FILE}")

    except FileNotFoundError:
        print(f"Error: File {INPUT_FILE} not found in the current folder!")

if __name__ == "__main__":
    process_file()