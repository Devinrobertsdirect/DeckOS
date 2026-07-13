from openai import OpenAI
import time
from pygame import mixer
import os

#https://platform.openai.com/playground/assistants

# Initialize the OpenAI client with your API key and mixer
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
mixer.init()

assistant_id = "asst_A8FZLaHdpKmfcBwbkZFYgKxi"
thread_id = "thread_PIrP1sZxymrec8H6nuJflxp7"

# Retrieve the assistant and thread
try:
    assistant = client.beta.assistants.retrieve(assistant_id)
    thread = client.beta.threads.retrieve(thread_id)
except Exception as e:
    print(f"Error retrieving assistant or thread: {e}")
    exit(1)

def ask_question_memory(question):
    try:
        client.beta.threads.messages.create(
            thread.id,
            role="user",
            content=question,
        )

        run = client.beta.threads.runs.create(
            thread_id=thread.id,
            assistant_id=assistant.id,
        )

        while True:
            run_status = client.beta.threads.runs.retrieve(
                thread_id=thread.id,
                run_id=run.id,
            )
            if run_status.status == 'completed':
                break
            elif run_status.status == 'failed':
                return "The run has failed"
            time.sleep(0.5)

        messages = client.beta.threads.messages.list(
            thread_id=thread.id
        )
        return messages.data[0].content[0].text.value
    except Exception as e:
        print(f"Error asking question: {e}")
        return None

def generate_tts(sentence, speech_file_path):
    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=sentence,
        )

        with open(speech_file_path, 'wb') as f:
            f.write(response.content)

        return str(speech_file_path)
    except Exception as e:
        print(f"Error generating TTS: {e}")
        return None

def play_sound(file_path):
    try:
        if not mixer.get_init():
            mixer.init()
        mixer.music.load(file_path)
        mixer.music.play()
    except Exception as e:
        print(f"Error playing sound: {e}")

def TTS(text):
    speech_file_path = "speech.mp3"
    file_path = generate_tts(text, speech_file_path)
    if file_path:
        play_sound(file_path)
        while mixer.music.get_busy():
            time.sleep(1)
        mixer.music.unload()
        os.remove(speech_file_path)
        return "done"
    else:
        return "TTS generation failed"