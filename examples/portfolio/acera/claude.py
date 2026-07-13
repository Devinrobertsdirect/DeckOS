import requests

def ask_question(question, api_key):
    url = "https://api.anthropic.com/v1/complete"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    data = {
        'prompt': question,
        'max_tokens': 100
    }
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 200:
        response_data = response.json()
        return response_data['completion']
    else:
        return "Failed to get a response from Claude."

def TTS(text):
    # Your TTS implementation here
    print("TTS:", text)
