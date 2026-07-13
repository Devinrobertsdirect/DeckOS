import pygame
import pyautogui

# Function to get screen size using Pygame
def get_screen_size():
    pygame.init()
    info = pygame.display.Info()
    width = info.current_w
    height = info.current_h
    pygame.quit()
    return width, height

# Function to move the mouse to absolute coordinates
def move_mouse(x, y):
    pyautogui.moveTo(x, y)

# Function to click the mouse
def click_mouse():
    pyautogui.click()

# Function to scroll the mouse
def scroll_mouse(direction):
    if direction == "up":
        pyautogui.scroll(10)
    elif direction == "down":
        pyautogui.scroll(-10)

# TODO - change pixels is not good especially if using a 4k screen
# Function to parse and execute commands
def parse_command(command):
    if command == "print":
        print("Hello World!")
        print("Exiting program")
        exit()
    elif command == "move_mouse_up":
        pyautogui.moveRel(0, -500)  # Move mouse up by 100 pixels
        print("Moved mouse up")
    elif command == "move_mouse_down":
        pyautogui.moveRel(0, 500)  # Move mouse down by 100 pixels
        print("Moved mouse down")
    elif command == "move_mouse_left":
        pyautogui.moveRel(-500, 0)  # Move mouse left by 100 pixels
        print("Moved mouse left")
    elif command == "move_mouse_right":
        pyautogui.moveRel(500, 0)  # Move mouse right by 100 pixels
        print("Moved mouse right")
    else:
        print("Invalid command")
