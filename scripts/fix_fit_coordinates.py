#!/usr/bin/env python3
"""Patch FIT record coordinates from GCJ-02 to WGS-84 and rebuild file CRC."""

from __future__ import annotations

import argparse
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


FIT_EPOCH_UNIX_OFFSET = 631065600
CRC_TABLE = [
    0x0000,
    0xCC01,
    0xD801,
    0x1400,
    0xF001,
    0x3C00,
    0x2800,
    0xE401,
    0xA001,
    0x6C00,
    0x7800,
    0xB401,
    0x5000,
    0x9C01,
    0x8801,
    0x4400,
]


@dataclass
class FieldDef:
    number: int
    size: int
    base_type: int
    offset: int


@dataclass
class Definition:
    global_message_number: int
    little_endian: bool
    fields: List[FieldDef]
    size: int


def fit_crc(data: bytes | bytearray) -> int:
    crc = 0
    for byte in data:
        tmp = CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF]
        tmp = CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF]
    return crc & 0xFFFF


def read_ascii(data: bytes | bytearray, offset: int, length: int) -> str:
    return bytes(data[offset : offset + length]).decode("ascii", errors="replace")


def read_u16(data: bytes | bytearray, offset: int, little_endian: bool) -> int:
    return struct.unpack_from("<H" if little_endian else ">H", data, offset)[0]


def read_i32(data: bytes | bytearray, offset: int, little_endian: bool) -> int:
    return struct.unpack_from("<i" if little_endian else ">i", data, offset)[0]


def write_i32(data: bytearray, offset: int, value: int, little_endian: bool) -> None:
    struct.pack_into("<i" if little_endian else ">i", data, offset, value)


def semicircles_to_degrees(value: int) -> float:
    return value * (180.0 / 2147483648.0)


def degrees_to_semicircles(value: float) -> int:
    return int(round(value * 2147483648.0 / 180.0))


def is_in_china(lat: float, lon: float) -> bool:
    return 72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271


def transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
    ret += 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def transform_lon(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
    ret += 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lat: float, lon: float) -> Tuple[float, float]:
    a = 6378245.0
    ee = 0.00669342162296594323
    d_lat = transform_lat(lon - 105.0, lat - 35.0)
    d_lon = transform_lon(lon - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - ee * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = (d_lat * 180.0) / ((a * (1 - ee)) / (magic * sqrt_magic) * math.pi)
    d_lon = (d_lon * 180.0) / (a / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lat + d_lat, lon + d_lon


def gcj02_to_wgs84_exact(lat: float, lon: float) -> Tuple[float, float]:
    min_lat = lat - 0.02
    max_lat = lat + 0.02
    min_lon = lon - 0.02
    max_lon = lon + 0.02
    current_lat = lat
    current_lon = lon
    for _ in range(30):
        current_lat = (min_lat + max_lat) / 2
        current_lon = (min_lon + max_lon) / 2
        converted_lat, converted_lon = wgs84_to_gcj02(current_lat, current_lon)
        delta_lat = converted_lat - lat
        delta_lon = converted_lon - lon
        if abs(delta_lat) < 1e-8 and abs(delta_lon) < 1e-8:
            break
        if delta_lat > 0:
            max_lat = current_lat
        else:
            min_lat = current_lat
        if delta_lon > 0:
            max_lon = current_lon
        else:
            min_lon = current_lon
    return current_lat, current_lon


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    r_lat1 = math.radians(lat1)
    r_lat2 = math.radians(lat2)
    hav = math.sin(d_lat / 2) ** 2 + math.cos(r_lat1) * math.cos(r_lat2) * math.sin(d_lon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(hav), math.sqrt(1 - hav))


def parse_definition(data: bytearray, offset: int, has_developer_data: bool) -> Tuple[Definition, int, int]:
    offset += 1
    architecture = data[offset]
    offset += 1
    little_endian = architecture == 0
    global_message_number = read_u16(data, offset, little_endian)
    offset += 2
    field_count = data[offset]
    offset += 1

    fields: List[FieldDef] = []
    message_offset = 0
    for _ in range(field_count):
        number = data[offset]
        size = data[offset + 1]
        base_type = data[offset + 2]
        fields.append(FieldDef(number=number, size=size, base_type=base_type, offset=message_offset))
        message_offset += size
        offset += 3

    developer_field_count = 0
    if has_developer_data:
        developer_field_count = data[offset]
        offset += 1
        for _ in range(developer_field_count):
            _developer_field_number = data[offset]
            developer_size = data[offset + 1]
            _developer_data_index = data[offset + 2]
            message_offset += developer_size
            offset += 3

    return Definition(global_message_number, little_endian, fields, message_offset), offset, developer_field_count


def patch_fit_coordinates(input_path: Path, output_path: Path, *, overwrite: bool = False) -> dict:
    if output_path.exists() and not overwrite:
        raise FileExistsError(f"output already exists, pass --overwrite to replace it: {output_path}")

    original = input_path.read_bytes()
    data = bytearray(original)

    if len(data) < 14:
        raise ValueError("file is too small to be a FIT file")

    header_size = data[0]
    if header_size not in (12, 14):
        raise ValueError(f"unexpected FIT header size: {header_size}")
    if read_ascii(data, 8, 4) != ".FIT":
        raise ValueError("file signature is not .FIT")

    data_size = struct.unpack_from("<I", data, 4)[0]
    expected_size = header_size + data_size + 2
    if expected_size > len(data):
        raise ValueError(f"FIT declared size {expected_size} exceeds file size {len(data)}")
    if expected_size < len(data):
        data = data[:expected_size]

    stored_file_crc = struct.unpack_from("<H", data, len(data) - 2)[0]
    computed_file_crc = fit_crc(data[:-2])
    original_crc_ok = stored_file_crc == computed_file_crc

    stored_header_crc: Optional[int] = None
    computed_header_crc: Optional[int] = None
    header_crc_ok: Optional[bool] = None
    if header_size == 14:
        stored_header_crc = struct.unpack_from("<H", data, 12)[0]
        computed_header_crc = fit_crc(data[:12])
        header_crc_ok = stored_header_crc == computed_header_crc

    definitions: Dict[int, Definition] = {}
    offset = header_size
    data_end = header_size + data_size
    record_messages = 0
    coordinate_records = 0
    changed_records = 0
    skipped_outside_china = 0
    total_shift = 0.0
    max_shift = 0.0
    developer_field_count = 0
    first_timestamp: Optional[int] = None
    last_timestamp: Optional[int] = None

    while offset < data_end:
        record_header = data[offset]
        offset += 1

        if record_header & 0x80:
            local_message_type = (record_header >> 5) & 0x03
            definition = definitions.get(local_message_type)
            if definition is None:
                raise ValueError(f"missing compressed definition for local message {local_message_type}")
            data_offset = offset
            offset += definition.size
            if definition.global_message_number == 20:
                record_messages += 1
                result = patch_record(data, data_offset, definition)
                if result["has_coordinate"]:
                    coordinate_records += 1
                if result["changed"]:
                    changed_records += 1
                    total_shift += result["shift_m"]
                    max_shift = max(max_shift, result["shift_m"])
                elif result["outside_china"]:
                    skipped_outside_china += 1
                if result["timestamp"] is not None:
                    first_timestamp = first_timestamp or result["timestamp"]
                    last_timestamp = result["timestamp"]
            continue

        local_message_type = record_header & 0x0F
        has_developer_data = bool(record_header & 0x20)
        is_definition = bool(record_header & 0x40)

        if is_definition:
            definition, offset, dev_count = parse_definition(data, offset, has_developer_data)
            developer_field_count += dev_count
            definitions[local_message_type] = definition
            continue

        definition = definitions.get(local_message_type)
        if definition is None:
            raise ValueError(f"missing definition for local message {local_message_type}")
        data_offset = offset
        offset += definition.size
        if definition.global_message_number == 20:
            record_messages += 1
            result = patch_record(data, data_offset, definition)
            if result["has_coordinate"]:
                coordinate_records += 1
            if result["changed"]:
                changed_records += 1
                total_shift += result["shift_m"]
                max_shift = max(max_shift, result["shift_m"])
            elif result["outside_china"]:
                skipped_outside_china += 1
            if result["timestamp"] is not None:
                first_timestamp = first_timestamp or result["timestamp"]
                last_timestamp = result["timestamp"]

    new_crc = fit_crc(data[:-2])
    struct.pack_into("<H", data, len(data) - 2, new_crc)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(data)

    verify_written = output_path.read_bytes()
    written_stored_crc = struct.unpack_from("<H", verify_written, len(verify_written) - 2)[0]
    written_computed_crc = fit_crc(verify_written[:-2])

    return {
        "input_file": str(input_path),
        "output_file": str(output_path),
        "file_size_bytes": len(data),
        "header_size": header_size,
        "data_size": data_size,
        "original_file_crc_ok": original_crc_ok,
        "original_header_crc_ok": header_crc_ok,
        "record_messages": record_messages,
        "coordinate_records": coordinate_records,
        "changed_records": changed_records,
        "skipped_outside_china": skipped_outside_china,
        "developer_field_definitions": developer_field_count,
        "average_shift_m": round(total_shift / changed_records, 2) if changed_records else 0,
        "max_shift_m": round(max_shift, 2),
        "first_timestamp_unix": first_timestamp + FIT_EPOCH_UNIX_OFFSET if first_timestamp else None,
        "last_timestamp_unix": last_timestamp + FIT_EPOCH_UNIX_OFFSET if last_timestamp else None,
        "new_file_crc": new_crc,
        "written_file_crc_ok": written_stored_crc == written_computed_crc,
    }


def patch_record(data: bytearray, data_offset: int, definition: Definition) -> dict:
    fields_by_number = {field.number: field for field in definition.fields}
    lat_field = fields_by_number.get(0)
    lon_field = fields_by_number.get(1)
    timestamp_field = fields_by_number.get(253)
    result = {
        "has_coordinate": False,
        "changed": False,
        "outside_china": False,
        "shift_m": 0.0,
        "timestamp": None,
    }

    if timestamp_field and timestamp_field.size >= 4:
        raw_timestamp = struct.unpack_from(
            "<I" if definition.little_endian else ">I",
            data,
            data_offset + timestamp_field.offset,
        )[0]
        if raw_timestamp != 0xFFFFFFFF:
            result["timestamp"] = raw_timestamp

    if not lat_field or not lon_field:
        return result
    if lat_field.size != 4 or lon_field.size != 4:
        return result

    lat_raw = read_i32(data, data_offset + lat_field.offset, definition.little_endian)
    lon_raw = read_i32(data, data_offset + lon_field.offset, definition.little_endian)
    if lat_raw in (0x7FFFFFFF, -0x80000000) or lon_raw in (0x7FFFFFFF, -0x80000000):
        return result

    lat = semicircles_to_degrees(lat_raw)
    lon = semicircles_to_degrees(lon_raw)
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return result

    result["has_coordinate"] = True
    if not is_in_china(lat, lon):
        result["outside_china"] = True
        return result

    fixed_lat, fixed_lon = gcj02_to_wgs84_exact(lat, lon)
    fixed_lat_raw = degrees_to_semicircles(fixed_lat)
    fixed_lon_raw = degrees_to_semicircles(fixed_lon)

    if fixed_lat_raw != lat_raw or fixed_lon_raw != lon_raw:
        write_i32(data, data_offset + lat_field.offset, fixed_lat_raw, definition.little_endian)
        write_i32(data, data_offset + lon_field.offset, fixed_lon_raw, definition.little_endian)
        result["changed"] = True
        result["shift_m"] = distance_meters(lat, lon, fixed_lat, fixed_lon)

    return result


def default_output_path(input_path: Path, output_dir: Path, suffix: str) -> Path:
    return output_dir / f"{input_path.stem}{suffix}.fit"


def default_summary_path(input_path: Path, summary_dir: Path, suffix: str) -> Path:
    return summary_dir / f"{input_path.stem}{suffix}.summary.json"


def write_summary(summary_path: Path, summary: dict) -> None:
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def process_inputs(
    input_paths: Iterable[Path],
    *,
    output_dir: Path,
    summary_dir: Path,
    suffix: str,
    overwrite: bool,
) -> List[dict]:
    summaries: List[dict] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_dir.mkdir(parents=True, exist_ok=True)

    for input_path in input_paths:
        output_path = default_output_path(input_path, output_dir, suffix)
        summary_path = default_summary_path(input_path, summary_dir, suffix)
        summary = patch_fit_coordinates(input_path, output_path, overwrite=overwrite)
        summary["summary_file"] = str(summary_path)
        write_summary(summary_path, summary)
        summaries.append(summary)

    return summaries


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch FIT coordinates from GCJ-02 to WGS-84.")
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, help="Output FIT path for single-file mode.")
    parser.add_argument("--summary", type=Path, help="Summary JSON path for single-file mode.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"), help="Output directory for batch mode.")
    parser.add_argument("--summary-dir", type=Path, help="Summary directory for batch mode. Defaults to --output-dir.")
    parser.add_argument("--suffix", default=".wgs84-fixed", help="Suffix before .fit/.summary.json in batch mode.")
    parser.add_argument("--overwrite", action="store_true", help="Replace existing output files.")
    args = parser.parse_args()

    if len(args.inputs) == 1 and (args.output or args.summary):
        if not args.output or not args.summary:
            parser.error("--output and --summary must be provided together in single-file mode")
        summary = patch_fit_coordinates(args.inputs[0], args.output, overwrite=args.overwrite)
        summary["summary_file"] = str(args.summary)
        write_summary(args.summary, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    if args.output or args.summary:
        parser.error("--output/--summary can only be used with exactly one input")

    summary_dir = args.summary_dir or args.output_dir
    summaries = process_inputs(
        args.inputs,
        output_dir=args.output_dir,
        summary_dir=summary_dir,
        suffix=args.suffix,
        overwrite=args.overwrite,
    )
    batch_summary = {
        "processed_files": len(summaries),
        "changed_records": sum(item["changed_records"] for item in summaries),
        "coordinate_records": sum(item["coordinate_records"] for item in summaries),
        "written_file_crc_ok": all(item["written_file_crc_ok"] for item in summaries),
        "outputs": [
            {
                "input_file": item["input_file"],
                "output_file": item["output_file"],
                "summary_file": item["summary_file"],
                "changed_records": item["changed_records"],
                "average_shift_m": item["average_shift_m"],
                "written_file_crc_ok": item["written_file_crc_ok"],
            }
            for item in summaries
        ],
    }
    print(json.dumps(batch_summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
