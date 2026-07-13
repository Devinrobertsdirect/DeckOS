import pyttsx3
import speech_recognition as sr
from decouple import config
import random
import requests
from online_ops import find_my_ip, get_latest_news, get_random_advice, get_random_joke, play_on_youtube, search_on_google, search_on_wikipedia, send_whatsapp_message
from os_ops import open_calculator, open_camera, open_cmd, open_notepad, open_discord
from pprint import pprint
from dotenv import load_dotenv
import os

class AssistantModule:
 def __init__(self):
        # Initialize any necessary variables or attributes
        pass

 def initialize(self):
        # Perform initialization tasks for the assistant module
        print("Initializing assistant module...")
        # Add any initialization tasks here
        self.Assistant.initialize()

 def process_user_input(self, user_input):
        # Process user input and trigger relevant actions
        print("Processing user input:", user_input)
        # Add logic to process user input and trigger relevant actions
        
 def execute_module_operations(self):
        # Execute operations of the assistant module based on system state or user input
        print("Executing assistant module operations...")
        # Add logic to execute operations based on system state or user input

 def __init__(self):
        # Initialize any necessary variables or attributes
        pass

 def initialize(self):
        # Perform initialization tasks for the assistant module
        print("Initializing assistant module...")
        # Add any initialization tasks here
        
# Load environment variables from .env file
 load_dotenv()

# Access the environment variables
USERNAME = os.getenv('USER')
BOTNAME = os.getenv('BOTNAME')
NEWS_API_KEY = os.getenv('NEWS_API_KEY')

engine = pyttsx3.init('sapi5')
engine.setProperty('rate', 190)
engine.setProperty('volume', 1.0)
voices = engine.getProperty('voices')
engine.setProperty('voice', voices[1].id)

from datetime import datetime
def greet_user():
    hour = datetime.now().hour
    if (hour >= 6) and (hour < 12):
        speak(f"Good Morning {USERNAME}")
    elif (hour >= 12) and (hour < 16):
        speak(f"Good afternoon {USERNAME}")
    elif (hour >= 16) and (hour < 19):
        speak(f"Good Evening {USERNAME}")
    speak(f"I am {BOTNAME}. How may I assist you?")

def listen():
    recognizer = sr.Recognizer()
    with sr.Microphone() as source:
        print("Listening...")
        random.pause_threshold = 1
        recognizer.adjust_for_ambient_noise(source)
        audio = recognizer.listen(source)
    try:
        print("Recognizing...")
        text = recognizer.recognize_google(audio)
        print("You said:", text)
        return text
    except sr.UnknownValueError:
        print("Sorry, I couldn't understand what you said.")
        return ""
    except sr.RequestError:
        print("Sorry, I couldn't access the Google API.")
        return ""

def execute_command(command):
    if "open browser" in command:
        print("Initializing browser...")
        # Add code to initialize browser
        print("Opening browser...")
        # Add code to open a web browser
    elif "play music" in command:
        print("Initializing music player...")
        # Add code to initialize music player
        print("Playing music...")
        # Add code to play music
    elif "send email" in command:
        print("Initializing email service...")
        # Add code to initialize email service
        print("Sending email...")
        # Add code to send an email
    elif "search on the web" in command:
        print("Initializing web search...")
        # Add code to initialize web search
        print("Searching on the web...")
        # Add code to perform web search
    elif "set reminder" in command:
        print("Initializing reminder service...")
        # Add code to initialize reminder service
        print("Setting reminder...")
        # Add code to set a reminder
    elif "control lights" in command:
        print("Initializing smart lighting control...")
        # Add code to initialize smart lighting control
        print("Controlling lights...")
        # Add code to control lights
    elif "check weather" in command:
        print("Initializing weather service...")
        # Add code to initialize weather service
        print("Checking weather...")
        # Add code to check weather
    elif "read news" in command:
        print("Initializing news reader...")
        # Add code to initialize news reader
        print("Reading news...")
        # Add code to read news
    elif "translate text" in command:
        print("Initializing translation service...")
        # Add code to initialize translation service
        print("Translating text...")
        # Add code to translate text
    elif "calculate" in command:
        print("Initializing calculator...")
        # Add code to initialize calculator
        print("Calculating...")
        # Add code to perform calculation
    elif "set alarm" in command:
        print("Initializing alarm service...")
        # Add code to initialize alarm service
        print("Setting alarm...")
        # Add code to set alarm
    elif "control home appliances" in command:
        print("Initializing smart home control...")
        # Add code to initialize smart home control
        print("Controlling home appliances...")
        # Add code to control home appliances
    elif "schedule meeting" in command:
        print("Initializing calendar service...")
        # Add code to initialize calendar service
        print("Scheduling meeting...")
        # Add code to schedule meeting
    elif "find directions" in command:
        print("Initializing navigation service...")
        # Add code to initialize navigation service
        print("Finding directions...")
        # Add code to find directions
    elif "take notes" in command:
        print("Initializing note-taking service...")
        # Add code to initialize note-taking service
        print("Taking notes...")
        # Add code to take notes
    else:
        print("Sorry, I don't understand that command.")

def speak(text):
    engine.say(text)
    engine.runAndWait()

if __name__ == '__main__':
    greet_user()
    while True:
        query = listen().lower()
        if 'open notepad' in query:
            open_notepad()
        elif 'open discord' in query:
            open_discord()
        elif 'open command prompt' in query or 'open cmd' in query:
            open_cmd()
        elif 'open camera' in query:
            open_camera()
        elif 'open calculator' in query:
            open_calculator()
        elif 'ip address' in query:
            ip_address = find_my_ip()
            speak(f'Your IP Address is {ip_address}.\n For your convenience, I am printing it on the screen sir.')
            print(f'Your IP Address is {ip_address}')
        elif 'wikipedia' in query:
            speak('What do you want to search on Wikipedia, sir?')
            search_query = listen().lower()
            results = search_on_wikipedia(search_query)
            speak(f"According to Wikipedia, {results}")
            speak("For your convenience, I am printing it on the screen sir.")
            print(results)
        elif 'youtube' in query:
            speak('What do you want to play on Youtube, sir?')
            video = listen().lower()
            play_on_youtube(video)
        elif 'search on google' in query:
            speak('What do you want to search on Google, sir?')
            query = listen().lower()
            search_on_google(query)
        elif "send whatsapp message" in query:
            speak('On what number should I send the message sir? Please enter in the console: ')
            number = input("Enter the number: ")
            speak("What is the message sir?")
            message = listen().lower()
            send_whatsapp_message(number, message)
            speak("I've sent the message sir.")
        elif "send an email" in query:
            speak("On what email address do I send sir? Please enter in the console: ")
            receiver_address = input("Enter email address: ")
            speak("What should be the subject sir?")
            subject = listen().capitalize()
            speak("What is the message sir?")
            message = listen().capitalize()
            if send_email(receiver_address, subject, message):
                speak("I've sent the email sir.")
            else:
                speak("Something went wrong while I was sending the mail. Please check the error logs sir.")
        elif 'joke' in query:
            speak(f"Hope you like this one sir")
            joke = get_random_joke()
            speak(joke)
            speak("For your convenience, I am printing it on the screen sir.")
            pprint(joke)
        elif "advice" in query:
            speak(f"Here's an advice for you, sir")
            advice = get_random_advice()
            speak(advice)
            speak("For your convenience, I am printing it on the screen sir.")
            pprint(advice)
        elif "trending movies" in query:
            speak(f"Some of the trending movies are: {get_trending_movies()}")
            speak("For your convenience, I am printing it on the screen sir.")
            print(*get_trending_movies(), sep='\n')
        elif 'news' in query:
            speak(f"I'm reading out the latest news headlines, sir")
            speak(get_latest_news())
            speak("For your convenience, I am printing it on the screen sir.")
            print(*get_latest_news(), sep='\n')
        elif 'weather' in query:
            ip_address = find_my_ip()
            city = requests.get(f"https://ipapi.co/{ip_address}/city/").text
            speak(f"Getting weather report for your city {city}")
            weather, temperature, feels_like = get_weather_report(city)
            speak(f"The current temperature is {temperature}, but it feels like {feels_like}")
            speak(f"Also, the weather report talks about {weather}")
            speak("For your convenience, I am printing it on the screen sir.")
            print(f"Description: {weather}\nTemperature: {temperature}\nFeels like: {feels_like}")
