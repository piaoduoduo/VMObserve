"""Shared full-smaps parser for course address and allocation experiments."""
import re

FIELDS = {"size_kib": "Size", "rss_kib": "Rss", "pss_kib": "Pss",
          "private_dirty_kib": "Private_Dirty", "shared_dirty_kib": "Shared_Dirty",
          "huge_kib": "AnonHugePages", "swap_kib": "Swap"}
HEADER = re.compile(r"^([0-9a-f]+)-([0-9a-f]+) ([rwxps-]{4})\s+([0-9a-f]+)\s+\S+\s+\d+[^\n]*$", re.M)


def parse_mappings(body):
    headers = list(HEADER.finditer(body))
    if not headers:
        raise ValueError("smaps has no mappings")
    mappings = []
    previous_end = 0
    for i, header in enumerate(headers):
        start, end = int(header[1], 16), int(header[2], 16)
        if start < previous_end or end <= start:
            raise ValueError("overlapping or invalid mapping ranges")
        previous_end = end
        section = body[header.end():headers[i + 1].start() if i + 1 < len(headers) else len(body)]
        fields = header[0].split(maxsplit=5)
        mapping = {"start": header[1], "end": header[2], "header": header[0],
                   "permissions": header[3], "file_offset": int(header[4], 16),
                   "pathname": fields[5] if len(fields) == 6 else ""}
        for field, label in FIELDS.items():
            values = re.findall(rf"^{label}:\s+(\d+) kB$", section, re.M)
            if len(values) != 1:
                raise ValueError("missing/duplicate smaps metric " + label)
            mapping[field] = int(values[0])
        if mapping["size_kib"] * 1024 != end - start or not 0 <= mapping["pss_kib"] <= mapping["rss_kib"] <= mapping["size_kib"]:
            raise ValueError("inconsistent mapping metrics")
        mappings.append(mapping)
    return mappings
