import re
import base64
import os

html_path = r'd:\call analysis\templates\index.html'
output_path = r'd:\call analysis\templates\vapi_icon.svg'

try:
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    match = re.search(r'icon="data:image/svg\+xml;base64,([^"]+)"', content)
    if match:
        b64_str = match.group(1)
        # Decode
        svg_bytes = base64.b64decode(b64_str)
        with open(output_path, 'wb') as f:
            f.write(svg_bytes)
        print(f"Successfully extracted SVG to {output_path}")
    else:
        print("Could not find base64 icon string in index.html")

except Exception as e:
    print(f"Error: {e}")
