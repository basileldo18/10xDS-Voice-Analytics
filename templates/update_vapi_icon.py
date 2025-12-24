import re
import base64
import os

html_path = r'd:\call analysis\templates\index.html'

def update_icon():
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find current icon
        match = re.search(r'icon="data:image/svg\+xml;base64,([^"]+)"', content)
        if not match:
            print("Could not find icon attribute")
            return

        current_b64 = match.group(1)
        current_svg = base64.b64decode(current_b64).decode('utf-8')

        # Replace white with black
        # The SVG uses #ffffff
        new_svg = current_svg.replace('#ffffff', '#000000')
        
        # Verify change
        if '#000000' not in new_svg:
            print("Warning: Color replacement might have failed.")
        
        # Encode back to base64
        new_b64 = base64.b64encode(new_svg.encode('utf-8')).decode('utf-8')
        
        # Perform replacement in HTML
        new_content = content.replace(current_b64, new_b64)
        
        # Write back
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
        print("Successfully updated index.html with black icon.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    update_icon()
