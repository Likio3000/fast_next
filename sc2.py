import os
import pyperclip
import argparse

try:
    import pathspec
except ImportError:
    pathspec = None
    print("Warning: 'pathspec' library not found. .gitignore support will be disabled.")

# --- Configuration ---

# Add file extensions you want to include (lowercase)
ALLOWED_EXTENSIONS = {
    '.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.sass',
    '.json', '.yaml', '.yml', '.xml', '.md', '.txt', '.sh', '.bash', '.zsh',
    '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.rb',
    '.sql'
}

# Add specific full filenames to include regardless of extension
ALLOWED_FILENAMES = {
    'dockerfile', 'docker-compose.yml', '.env.example', '.gitignore',
    'requirements.txt', 'package.json', 'composer.json', 'pom.xml', 'gemfile'
}

# Add directory names to completely exclude (lowercase)
EXCLUDED_DIRS = {
    '.git', '.svn', '.hg', '__pycache__', 'node_modules', 'vendor', 'egg-info',
    'target', 'build', 'dist', 'out', 'bin', 'obj', '.vscode', '.idea', '.next', '.venv', 'venv', '.env', 'env'
}
EXCLUDED_DIRS = {d.lower() for d in EXCLUDED_DIRS}

# Add specific filenames to exclude (lowercase)
EXCLUDED_FILES = {
    '.env', 'credentials.json', 'secrets.yaml',
    'package-lock.json', 'yarn.lock', 'composer.lock'
}
EXCLUDED_FILES = {f.lower() for f in EXCLUDED_FILES}

# Maximum individual file size to include (in bytes)
MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024  # 1 MB limit per file


def load_gitignore(project_dir):
    """
    Load .gitignore from the project directory if available.
    Returns a compiled pathspec object or None.
    """
    gitignore_path = os.path.join(project_dir, '.gitignore')
    if os.path.exists(gitignore_path) and pathspec:
        try:
            with open(gitignore_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            spec = pathspec.PathSpec.from_lines('gitwildmatch', lines)
            print("Loaded .gitignore patterns.")
            return spec
        except Exception as e:
            print(f"Error loading .gitignore: {e}")
    return None


def collect_project_contents(project_dir):
    """
    Collects relevant text file contents from a project directory.
    """
    all_contents = []
    project_dir = os.path.abspath(project_dir)

    if not os.path.isdir(project_dir):
        return f"Error: Directory not found: {project_dir}", False

    print(f"Scanning directory: {project_dir}")
    #print("Ignoring directories:", EXCLUDED_DIRS)
    #print("Ignoring files:", EXCLUDED_FILES)
    #print("Allowed extensions:", ALLOWED_EXTENSIONS)
    #print("Allowed filenames:", ALLOWED_FILENAMES)
    print("---")

    gitignore_spec = load_gitignore(project_dir)

    total_files_scanned = excluded_by_type = excluded_by_name = excluded_by_dir = 0
    excluded_by_size = excluded_by_gitignore = excluded_egg_info = read_errors = included_files_count = 0

    for root, dirs, files in os.walk(project_dir, topdown=True):
        # Filter out excluded dirs immediately
        dirs[:] = [d for d in dirs if d.lower() not in EXCLUDED_DIRS]

        # Skip entire directory if any segment matches excluded dirs
        rel_root = os.path.relpath(root, project_dir)
        segments = [seg.lower() for seg in rel_root.split(os.sep) if seg]
        if set(segments) & EXCLUDED_DIRS:
            excluded_by_dir += len(dirs) + len(files)
            dirs[:] = []
            continue

        for filename in files:
            total_files_scanned += 1
            file_path = os.path.join(root, filename)
            rel_path = os.path.relpath(file_path, project_dir)

            # Skip egg-info files
            if 'egg-info' in filename.lower():
                excluded_egg_info += 1
                continue

            # Exclude specific filenames
            if filename.lower() in EXCLUDED_FILES:
                excluded_by_name += 1
                continue

            # Check extension or specific filename
            ext = os.path.splitext(filename)[1].lower()
            if ext not in ALLOWED_EXTENSIONS and filename.lower() not in ALLOWED_FILENAMES:
                excluded_by_type += 1
                continue

            # .gitignore patterns
            if gitignore_spec and gitignore_spec.match_file(rel_path):
                excluded_by_gitignore += 1
                continue

            # Size check
            try:
                size = os.path.getsize(file_path)
                if size > MAX_FILE_SIZE_BYTES:
                    excluded_by_size += 1
                    continue
            except OSError:
                read_errors += 1
                continue

            # Read content
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                header = f"--- START FILE: {rel_path} ---\n"
                footer = f"\n--- END FILE: {rel_path} ---\n\n"
                all_contents.append(header + content + footer)
                included_files_count += 1
            except Exception:
                read_errors += 1

    # Summary
    print("---")
    print(f"Total scanned: {total_files_scanned}")
    print(f"Included files: {included_files_count}")
    print(f"Excluded by type: {excluded_by_type}")
    print(f"Excluded by name: {excluded_by_name}")
    print(f"Excluded by dir: {excluded_by_dir}")
    print(f"Excluded by size: {excluded_by_size}")
    print(f"Excluded by gitignore: {excluded_by_gitignore}")
    print(f"Excluded egg-info: {excluded_egg_info}")
    print(f"Read errors: {read_errors}")
    print("---")

    if not all_contents:
        return "No relevant files found or collected.", True

    return "".join(all_contents), True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Collect contents of text files in a project and copy to clipboard."
    )
    parser.add_argument("project_dir", nargs='?', default='.', help="Project directory (default: current)")
    parser.add_argument('-t', '--tests', action='store_true', help="Include 'tests/' directory")
    parser.add_argument('-w', '--write', action='store_true', help="Write output to 'sc2_output.txt' in project root")
    args = parser.parse_args()

    # By default exclude tests unless -t is provided
    if not args.tests:
        EXCLUDED_DIRS.add('tests')

    output, success = collect_project_contents(args.project_dir)
    if success:
        # Always copy to clipboard
        try:
            pyperclip.copy(output)
            print(f"Copied {len(output)} characters to clipboard.")
        except Exception as e:
            print(f"Warning: Could not copy to clipboard: {e}")

        # Optionally write to file
        if args.write:
            out_path = os.path.join(os.path.abspath(args.project_dir), 'sc2_output.txt')
            try:
                with open(out_path, 'w', encoding='utf-8') as f:
                    f.write(output)
                print(f"Written output to {out_path}")
            except Exception as e:
                print(f"Error writing output file: {e}")
    else:
        print(output)
