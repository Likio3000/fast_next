# AI Code Assistant

This project is a web-based AI assistant that helps users improve their code. It provides suggestions for refactoring and can generate improved code snippets based on those suggestions. The application features a Python backend powered by FastAPI and a clean, responsive frontend built with vanilla JavaScript, HTML, and CSS.

## Table of Contents
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Utility Script](#utility-script)

## Features

*   **Code Analysis and Suggestions:** Paste your code into the chat interface to receive improvement suggestions from an AI expert.
*   **Code Generation:** The assistant can refactor your code based on the provided suggestions, delivering a complete, updated version.
*   **Dual AI Provider Support:** Seamlessly switch between OpenAI and Gemini models for both suggestion and generation tasks.
*   **Streaming Responses:** Suggestions and generated code are streamed back to the user in real-time for a responsive experience.
*   **"Regenerate" Functionality:** Easily request a new set of suggestions or a different refactoring of your code.
*   **Responsive Design:** The user interface is designed to work on a variety of screen sizes.

## Project Structure

The project is organized into two main directories: `frontend/` and `backend/`.

*   `frontend/`: Contains all the files for the user interface.
    *   `index.html`: The main HTML file for the application.
    *   `style.css`: The stylesheet for the application.
    *   `main.js`: The core JavaScript file that handles user interaction and communication with the backend.

*   `backend/`: Contains the server-side application logic.
    *   `app/main.py`: The main FastAPI application file, which defines the API endpoints and handles requests.

*   `sc2.py`: A utility script to bundle all project text files into a single file or copy them to the clipboard.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   Python 3.7+
*   An OpenAI API key and/or a Gemini API key.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Likio3000/fast_next.git
    cd your-repository-directory
    ```

2.  **Set up the backend:**

    *   Navigate to the `backend` directory:
      ```bash
      cd backend
      ```
    *   Create and activate a virtual environment:
      ```bash
      python -m venv .venv
      source .venv/bin/activate # On Windows use `.venv\Scripts\activate`
      ```
    *   Install the required Python packages:
      ```bash
      pip install -r requirements.txt
      ```
    *   Copy `.env.example` to `.env` and edit it with your API keys and desired settings:
      ```bash
      cp .env.example .env
      # then open .env and update the values
      ```

3.  **Run the application:**
    *   From the `backend` directory, run the following command to start the server:
        ```bash
        uvicorn app.main:app --reload --port 8000
        ```
    *   Open your web browser and navigate to `http://localhost:8000`.

## Usage

1.  Open the application in your web browser.
2.  Paste your code into the input box at the bottom of the page.
3.  Click the "Send" button or press `Enter` to submit your code.
4.  The AI assistant will provide suggestions for improvement.
5.  If you want the assistant to refactor your code, it will do so based on the suggestions.
6.  You can use the "Regenerate" button to get new suggestions or a different version of the refactored code.

## Configuration

You can configure the AI providers for suggestions and code generation by setting the following environment variables in your `.env` file:

*   `SUGGESTION_PROVIDER`: Set to `openai` or `gemini` to choose the provider for suggestions.
*   `GENERATION_PROVIDER`: Set to `openai` or `gemini` to choose the provider for code generation.

You can also specify the model to be used for each provider:

*   `OPENAI_MODEL_NAME`: The name of the OpenAI model to use (e.g., `gpt-4`).
*   `GEMINI_MODEL_NAME`: The name of the Gemini model to use (e.g., `gemini-pro`).

## Utility Script

The `sc2.py` script is a helpful utility that gathers all the text-based files in your project and combines them into a single file or copies them to your clipboard. This can be useful for sharing your project's source code or for providing it as context to a language model.

To use the script, run the following command from the root directory of your project:

```bash
python sc2.py [project_directory]
```

You can also use the following options:

*   `-w` or `--write`: Write the output to a file.
*   `-t` or `--tests`: Include the `tests/` directory.
*   `-v` or `--verbose`: Print every included file to the console.
## License

This project is licensed under the [MIT License](LICENSE).
