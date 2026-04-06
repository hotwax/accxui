#!/usr/bin/env python3

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

def parse_args():
    parser = argparse.ArgumentParser(description="Convert Moqui entity exports into TypeScript mock files.")
    parser.add_argument("--input-file", required=True, help="Path to the Moqui entity export JSON file.")
    parser.add_argument("--output-dir", required=True, help="Directory to write the TypeScript mock files.")
    parser.add_argument("--entities", help="Comma-separated list of entities to process. If omitted, all entities will be processed.")
    return parser.parse_args()

def iter_sanitized_objects(raw_text: str):
    depth = 0
    in_string = False
    escape = False
    buffer: List[str] = []

    for char in raw_text:
        if depth == 0:
            if char == "{":
                depth = 1
                buffer = ["{"]
                in_string = False
                escape = False
            continue

        if in_string:
            if escape:
                buffer.append(char)
                escape = False
                continue

            if char == "\\":
                buffer.append(char)
                escape = True
                continue

            if char == '"':
                buffer.append(char)
                in_string = False
                continue

            code_point = ord(char)
            if char == "\n":
                buffer.append("\\n")
            elif char == "\r":
                buffer.append("\\r")
            elif char == "\t":
                buffer.append("\\t")
            elif code_point < 32:
                buffer.append(f"\\u{code_point:04x}")
            else:
                buffer.append(char)
            continue

        buffer.append(char)

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                yield "".join(buffer)
                buffer = []

def load_rows(path: Path) -> List[Dict[str, Any]]:
    # Attempt to load as a full JSON array first for efficiency
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, MemoryError):
        # Fallback to manual streaming for very large or slightly malformed JSON files
        raw_text = path.read_text()
        rows = []
        for object_text in iter_sanitized_objects(raw_text):
            rows.append(json.loads(object_text))
        return rows

def generate_mock_name(entity_name: str) -> str:
    # Capitalize the first letter and keep the rest as is
    # e.g., 'enums' -> 'mockEnums', 'enumerationTypes' -> 'mockEnumerationTypes'
    return f"mock{entity_name[:1].upper()}{entity_name[1:]}"

def main():
    args = parse_args()
    input_path = Path(args.input_file).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    target_entities = set(args.entities.split(",")) if args.entities else None

    if not input_path.exists():
        print(f"Error: Input file {input_path} does not exist.")
        return

    print(f"Loading entities from {input_path}...")
    all_rows = load_rows(input_path)
    
    # Group rows by entity
    entity_groups: Dict[str, List[Dict[str, Any]]] = {}
    for row in all_rows:
        entity = row.get("_entity")
        if not entity:
            continue
        
        if target_entities and entity not in target_entities:
            continue
            
        if entity not in entity_groups:
            entity_groups[entity] = []
        
        # Sanitize row (remove _entity)
        sanitized_row = {k: v for k, v in row.items() if k != "_entity"}
        entity_groups[entity].append(sanitized_row)

    # Generate mock files
    output_dir.mkdir(parents=True, exist_ok=True)
    for entity, rows in entity_groups.items():
        mock_var_name = generate_mock_name(entity)
        filename = f"{entity}.ts"
        output_path = output_dir / filename
        
        with open(output_path, 'w') as f:
            f.write(f"// Generated from {input_path.name}\n")
            f.write(f"export const {mock_var_name} = ")
            f.write(json.dumps(rows, indent=2, ensure_ascii=False))
            f.write(";\n")
        
        print(f"Generated {filename} with {len(rows)} entries.")

if __name__ == "__main__":
    main()
