(function () {
  "use strict";

  var FIT_EPOCH_UNIX_OFFSET = 631065600;
  var CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400,
    0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401,
    0x5000, 0x9C01, 0x8801, 0x4400
  ];

  var processedOutputs = [];

  var fileInput = document.getElementById("fitFiles");
  var message = document.getElementById("message");
  var fileCount = document.getElementById("fileCount");
  var coordinateCount = document.getElementById("coordinateCount");
  var changedCount = document.getElementById("changedCount");
  var averageShift = document.getElementById("averageShift");
  var crcStatus = document.getElementById("crcStatus");
  var downloadAllBtn = document.getElementById("downloadAllBtn");
  var shareBtn = document.getElementById("shareBtn");
  var openStravaBtn = document.getElementById("openStravaBtn");
  var resultList = document.getElementById("resultList");
  var details = document.getElementById("details");

  fileInput.addEventListener("change", handleFileChange);
  downloadAllBtn.addEventListener("click", downloadAll);
  shareBtn.addEventListener("click", shareAll);
  openStravaBtn.addEventListener("click", openStravaUpload);

  if (!navigator.share) {
    shareBtn.disabled = true;
  }

  async function handleFileChange(event) {
    var files = Array.prototype.slice.call(event.target.files || []);
    if (!files.length) return;

    resetOutput();
    setMessage("正在浏览器本地处理 " + files.length + " 个 FIT 文件。", false);

    var successes = [];
    var failures = [];

    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      try {
        var buffer = await file.arrayBuffer();
        var patched = patchFitCoordinates(buffer, file.name);
        var outputName = outputFitName(file.name);
        var summaryName = outputName.replace(/\.fit$/i, ".summary.json");
        var fitBlob = new Blob([patched.bytes], { type: "application/octet-stream" });
        var summaryBlob = new Blob([JSON.stringify(patched.summary, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
        var output = {
          sourceName: file.name,
          outputName: outputName,
          summaryName: summaryName,
          fitBlob: fitBlob,
          summaryBlob: summaryBlob,
          fitUrl: URL.createObjectURL(fitBlob),
          summaryUrl: URL.createObjectURL(summaryBlob),
          summary: patched.summary
        };
        processedOutputs.push(output);
        successes.push(output);
      } catch (error) {
        failures.push({
          sourceName: file.name,
          error: error.message || String(error)
        });
      }
    }

    renderResults(successes, failures);
    renderBatchSummary(successes, failures);
    renderDetails(successes, failures);

    if (successes.length) {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = successes.length === 1 ? "下载修正 FIT" : "下载全部修正 FIT";
      shareBtn.disabled = !canShareOutputs(successes);
      openStravaBtn.disabled = false;
    }

    if (successes.length && !failures.length) {
      setMessage("处理完成。可点“下载并打开 Strava 上传”，登录后在 Strava 页面选择刚下载的 FIT。", false);
    } else if (successes.length) {
      setMessage("部分文件处理完成，失败项见输出列表。", true);
    } else {
      setMessage("没有文件处理成功。", true);
    }
  }

  function patchFitCoordinates(buffer, sourceName) {
    var data = new Uint8Array(buffer.slice(0));
    if (data.byteLength < 14) {
      throw new Error("文件太小，不像 FIT 文件。");
    }

    var headerSize = data[0];
    if (headerSize !== 12 && headerSize !== 14) {
      throw new Error("FIT header 大小异常：" + headerSize);
    }
    if (readAscii(data, 8, 4) !== ".FIT") {
      throw new Error("文件签名不是 .FIT。");
    }

    var dataSize = readUint32(data, 4, true);
    var expectedSize = headerSize + dataSize + 2;
    if (expectedSize > data.byteLength) {
      throw new Error("FIT 声明大小超过文件长度，文件可能损坏。");
    }
    if (expectedSize < data.byteLength) {
      data = data.slice(0, expectedSize);
    }

    var storedFileCrc = readUint16(data, data.byteLength - 2, true);
    var computedFileCrc = fitCrc(data.subarray(0, data.byteLength - 2));
    var originalFileCrcOk = storedFileCrc === computedFileCrc;

    var headerCrcOk = null;
    if (headerSize === 14) {
      headerCrcOk = readUint16(data, 12, true) === fitCrc(data.subarray(0, 12));
    }

    var definitions = {};
    var offset = headerSize;
    var dataEnd = headerSize + dataSize;
    var recordMessages = 0;
    var coordinateRecords = 0;
    var changedRecords = 0;
    var skippedOutsideChina = 0;
    var totalShift = 0;
    var maxShift = 0;
    var developerFieldCount = 0;
    var firstTimestamp = null;
    var lastTimestamp = null;

    while (offset < dataEnd) {
      var recordHeader = data[offset];
      offset += 1;

      if (recordHeader & 0x80) {
        var compressedLocal = (recordHeader >> 5) & 0x03;
        var compressedDefinition = definitions[compressedLocal];
        if (!compressedDefinition) {
          throw new Error("缺少 compressed timestamp 定义：" + compressedLocal);
        }
        var compressedDataOffset = offset;
        offset += compressedDefinition.size;
        if (compressedDefinition.globalMessageNumber === 20) {
          recordMessages += 1;
          var compressedResult = patchRecord(data, compressedDataOffset, compressedDefinition);
          coordinateRecords += compressedResult.hasCoordinate ? 1 : 0;
          if (compressedResult.changed) {
            changedRecords += 1;
            totalShift += compressedResult.shiftMeters;
            maxShift = Math.max(maxShift, compressedResult.shiftMeters);
          } else if (compressedResult.outsideChina) {
            skippedOutsideChina += 1;
          }
          if (compressedResult.timestamp !== null) {
            if (firstTimestamp === null) firstTimestamp = compressedResult.timestamp;
            lastTimestamp = compressedResult.timestamp;
          }
        }
        continue;
      }

      var localMessageType = recordHeader & 0x0f;
      var hasDeveloperData = Boolean(recordHeader & 0x20);
      var isDefinition = Boolean(recordHeader & 0x40);

      if (isDefinition) {
        var parsedDefinition = parseDefinition(data, offset, hasDeveloperData);
        definitions[localMessageType] = parsedDefinition.definition;
        developerFieldCount += parsedDefinition.developerFieldCount;
        offset = parsedDefinition.nextOffset;
        continue;
      }

      var definition = definitions[localMessageType];
      if (!definition) {
        throw new Error("缺少 data message 定义：" + localMessageType);
      }
      var dataOffset = offset;
      offset += definition.size;
      if (definition.globalMessageNumber === 20) {
        recordMessages += 1;
        var result = patchRecord(data, dataOffset, definition);
        coordinateRecords += result.hasCoordinate ? 1 : 0;
        if (result.changed) {
          changedRecords += 1;
          totalShift += result.shiftMeters;
          maxShift = Math.max(maxShift, result.shiftMeters);
        } else if (result.outsideChina) {
          skippedOutsideChina += 1;
        }
        if (result.timestamp !== null) {
          if (firstTimestamp === null) firstTimestamp = result.timestamp;
          lastTimestamp = result.timestamp;
        }
      }
    }

    var newFileCrc = fitCrc(data.subarray(0, data.byteLength - 2));
    writeUint16(data, data.byteLength - 2, newFileCrc, true);
    var writtenFileCrcOk = readUint16(data, data.byteLength - 2, true) === fitCrc(data.subarray(0, data.byteLength - 2));

    var summary = {
      input_file: sourceName,
      output_file: outputFitName(sourceName),
      file_size_bytes: data.byteLength,
      header_size: headerSize,
      data_size: dataSize,
      original_file_crc_ok: originalFileCrcOk,
      original_header_crc_ok: headerCrcOk,
      record_messages: recordMessages,
      coordinate_records: coordinateRecords,
      changed_records: changedRecords,
      skipped_outside_china: skippedOutsideChina,
      developer_field_definitions: developerFieldCount,
      average_shift_m: changedRecords ? roundNumber(totalShift / changedRecords, 2) : 0,
      max_shift_m: roundNumber(maxShift, 2),
      first_timestamp_unix: firstTimestamp === null ? null : firstTimestamp + FIT_EPOCH_UNIX_OFFSET,
      last_timestamp_unix: lastTimestamp === null ? null : lastTimestamp + FIT_EPOCH_UNIX_OFFSET,
      new_file_crc: newFileCrc,
      written_file_crc_ok: writtenFileCrcOk,
      processing: "browser-local"
    };

    return {
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      summary: summary
    };
  }

  function parseDefinition(data, offset, hasDeveloperData) {
    offset += 1;
    var architecture = data[offset];
    offset += 1;
    var littleEndian = architecture === 0;
    var globalMessageNumber = readUint16(data, offset, littleEndian);
    offset += 2;
    var fieldCount = data[offset];
    offset += 1;

    var fields = [];
    var messageOffset = 0;
    for (var i = 0; i < fieldCount; i += 1) {
      var number = data[offset];
      var size = data[offset + 1];
      var baseType = data[offset + 2];
      fields.push({
        number: number,
        size: size,
        baseType: baseType,
        offset: messageOffset
      });
      messageOffset += size;
      offset += 3;
    }

    var developerFieldCount = 0;
    if (hasDeveloperData) {
      developerFieldCount = data[offset];
      offset += 1;
      for (var j = 0; j < developerFieldCount; j += 1) {
        var developerSize = data[offset + 1];
        messageOffset += developerSize;
        offset += 3;
      }
    }

    return {
      nextOffset: offset,
      developerFieldCount: developerFieldCount,
      definition: {
        globalMessageNumber: globalMessageNumber,
        littleEndian: littleEndian,
        fields: fields,
        size: messageOffset
      }
    };
  }

  function patchRecord(data, dataOffset, definition) {
    var fieldsByNumber = {};
    for (var i = 0; i < definition.fields.length; i += 1) {
      fieldsByNumber[definition.fields[i].number] = definition.fields[i];
    }

    var latField = fieldsByNumber[0];
    var lonField = fieldsByNumber[1];
    var timestampField = fieldsByNumber[253];
    var result = {
      hasCoordinate: false,
      changed: false,
      outsideChina: false,
      shiftMeters: 0,
      timestamp: null
    };

    if (timestampField && timestampField.size >= 4) {
      var timestamp = readUint32(data, dataOffset + timestampField.offset, definition.littleEndian);
      if (timestamp !== 0xffffffff) {
        result.timestamp = timestamp;
      }
    }

    if (!latField || !lonField) return result;
    if (latField.size !== 4 || lonField.size !== 4) return result;

    var latRaw = readInt32(data, dataOffset + latField.offset, definition.littleEndian);
    var lonRaw = readInt32(data, dataOffset + lonField.offset, definition.littleEndian);
    if (!isValidSint32(latRaw) || !isValidSint32(lonRaw)) return result;

    var lat = semicirclesToDegrees(latRaw);
    var lon = semicirclesToDegrees(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return result;

    result.hasCoordinate = true;
    if (!isInChina(lat, lon)) {
      result.outsideChina = true;
      return result;
    }

    var fixed = gcj02ToWgs84Exact(lat, lon);
    var fixedLatRaw = degreesToSemicircles(fixed.lat);
    var fixedLonRaw = degreesToSemicircles(fixed.lon);

    if (fixedLatRaw !== latRaw || fixedLonRaw !== lonRaw) {
      writeInt32(data, dataOffset + latField.offset, fixedLatRaw, definition.littleEndian);
      writeInt32(data, dataOffset + lonField.offset, fixedLonRaw, definition.littleEndian);
      result.changed = true;
      result.shiftMeters = distanceMeters(lat, lon, fixed.lat, fixed.lon);
    }

    return result;
  }

  function renderResults(successes, failures) {
    resultList.innerHTML = "";

    if (!successes.length && !failures.length) {
      resultList.innerHTML = '<p class="muted">尚未处理文件。</p>';
      return;
    }

    successes.forEach(function (output) {
      var item = document.createElement("div");
      item.className = "result-item";
      item.innerHTML = [
        '<div class="result-title"></div>',
        '<p class="result-meta"></p>',
        '<a class="download-link" download></a>',
        '<p class="result-meta"><a download>下载摘要 JSON</a></p>'
      ].join("");
      item.querySelector(".result-title").textContent = output.outputName;
      item.querySelector(".result-meta").textContent =
        "修正 " + output.summary.changed_records + " / " + output.summary.coordinate_records +
        " 个坐标记录，平均位移 " + output.summary.average_shift_m +
        " m，写出 CRC " + (output.summary.written_file_crc_ok ? "有效" : "异常") + "。";
      var fitLink = item.querySelector(".download-link");
      fitLink.href = output.fitUrl;
      fitLink.download = output.outputName;
      fitLink.textContent = "下载修正 FIT";
      var summaryLink = item.querySelector("p a");
      summaryLink.href = output.summaryUrl;
      summaryLink.download = output.summaryName;
      summaryLink.textContent = output.summaryName;
      resultList.appendChild(item);
    });

    failures.forEach(function (failure) {
      var item = document.createElement("div");
      item.className = "result-item";
      var title = document.createElement("div");
      title.className = "result-title";
      title.textContent = failure.sourceName;
      var error = document.createElement("p");
      error.className = "result-meta result-error";
      error.textContent = failure.error;
      item.appendChild(title);
      item.appendChild(error);
      resultList.appendChild(item);
    });
  }

  function renderBatchSummary(successes, failures) {
    var changed = sum(successes, function (output) { return output.summary.changed_records; });
    var coordinates = sum(successes, function (output) { return output.summary.coordinate_records; });
    var weightedShift = sum(successes, function (output) {
      return output.summary.average_shift_m * output.summary.changed_records;
    });
    var crcOk = successes.length ? successes.every(function (output) {
      return output.summary.written_file_crc_ok;
    }) : false;

    fileCount.textContent = String(successes.length) + (failures.length ? " / 失败 " + failures.length : "");
    coordinateCount.textContent = successes.length ? String(coordinates) : "-";
    changedCount.textContent = successes.length ? String(changed) : "-";
    averageShift.textContent = changed ? roundNumber(weightedShift / changed, 2) + " m" : "-";
    crcStatus.textContent = successes.length ? (crcOk ? "有效" : "异常") : "-";
  }

  function renderDetails(successes, failures) {
    details.textContent = JSON.stringify({
      processed_files: successes.length,
      failed_files: failures.length,
      changed_records: sum(successes, function (output) { return output.summary.changed_records; }),
      coordinate_records: sum(successes, function (output) { return output.summary.coordinate_records; }),
      written_file_crc_ok: successes.length ? successes.every(function (output) { return output.summary.written_file_crc_ok; }) : false,
      outputs: successes.map(function (output) {
        return output.summary;
      }),
      failures: failures
    }, null, 2);
  }

  function resetOutput() {
    revokeOutputs();
    processedOutputs = [];
    downloadAllBtn.disabled = true;
    shareBtn.disabled = true;
    openStravaBtn.disabled = true;
    downloadAllBtn.textContent = "下载修正 FIT";
    fileCount.textContent = "-";
    coordinateCount.textContent = "-";
    changedCount.textContent = "-";
    averageShift.textContent = "-";
    crcStatus.textContent = "-";
    resultList.innerHTML = '<p class="muted">尚未处理文件。</p>';
    details.textContent = "尚未处理文件。";
  }

  function setMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle("error", Boolean(isError));
  }

  function downloadAll() {
    processedOutputs.forEach(function (output, index) {
      window.setTimeout(function () {
        downloadBlobUrl(output.fitUrl, output.outputName);
      }, index * 250);
    });
  }

  async function shareAll() {
    if (!navigator.share || !processedOutputs.length) return;
    var files = processedOutputs.map(function (output) {
      return new File([output.fitBlob], output.outputName, { type: "application/octet-stream" });
    });
    if (navigator.canShare && !navigator.canShare({ files: files })) {
      files = files.slice(0, 1);
      if (!navigator.canShare({ files: files })) {
        setMessage("当前浏览器不支持分享修正后的 FIT，请使用下载。", true);
        return;
      }
    }
    await navigator.share({
      files: files,
      title: files.length === 1 ? files[0].name : "修正后的 FIT"
    });
  }

  function openStravaUpload() {
    downloadAll();
    window.open("https://www.strava.com/upload/select", "_blank", "noopener");
  }

  function canShareOutputs(outputs) {
    if (!navigator.share) return false;
    if (!navigator.canShare) return true;
    var files = outputs.map(function (output) {
      return new File([output.fitBlob], output.outputName, { type: "application/octet-stream" });
    });
    return navigator.canShare({ files: files }) || navigator.canShare({ files: files.slice(0, 1) });
  }

  function downloadBlobUrl(url, filename) {
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function revokeOutputs() {
    processedOutputs.forEach(function (output) {
      URL.revokeObjectURL(output.fitUrl);
      URL.revokeObjectURL(output.summaryUrl);
    });
  }

  function fitCrc(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i += 1) {
      var byte = bytes[i];
      var tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF];
      tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF];
    }
    return crc & 0xffff;
  }

  function readAscii(data, offset, length) {
    var value = "";
    for (var i = 0; i < length; i += 1) {
      value += String.fromCharCode(data[offset + i]);
    }
    return value;
  }

  function readUint16(data, offset, littleEndian) {
    var view = new DataView(data.buffer, data.byteOffset + offset, 2);
    return view.getUint16(0, littleEndian);
  }

  function writeUint16(data, offset, value, littleEndian) {
    var view = new DataView(data.buffer, data.byteOffset + offset, 2);
    view.setUint16(0, value, littleEndian);
  }

  function readUint32(data, offset, littleEndian) {
    var view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return view.getUint32(0, littleEndian);
  }

  function readInt32(data, offset, littleEndian) {
    var view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return view.getInt32(0, littleEndian);
  }

  function writeInt32(data, offset, value, littleEndian) {
    var view = new DataView(data.buffer, data.byteOffset + offset, 4);
    view.setInt32(0, value, littleEndian);
  }

  function isValidSint32(value) {
    return Number.isFinite(value) && value !== 0x7fffffff && value !== -0x80000000;
  }

  function semicirclesToDegrees(value) {
    return value * (180.0 / 2147483648.0);
  }

  function degreesToSemicircles(value) {
    return Math.round(value * 2147483648.0 / 180.0);
  }

  function isInChina(lat, lon) {
    return lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
  }

  function gcj02ToWgs84Exact(lat, lon) {
    var minLat = lat - 0.02;
    var maxLat = lat + 0.02;
    var minLon = lon - 0.02;
    var maxLon = lon + 0.02;
    var currentLat = lat;
    var currentLon = lon;

    for (var i = 0; i < 30; i += 1) {
      currentLat = (minLat + maxLat) / 2;
      currentLon = (minLon + maxLon) / 2;
      var converted = wgs84ToGcj02(currentLat, currentLon);
      var deltaLat = converted.lat - lat;
      var deltaLon = converted.lon - lon;
      if (Math.abs(deltaLat) < 1e-8 && Math.abs(deltaLon) < 1e-8) break;
      if (deltaLat > 0) {
        maxLat = currentLat;
      } else {
        minLat = currentLat;
      }
      if (deltaLon > 0) {
        maxLon = currentLon;
      } else {
        minLon = currentLon;
      }
    }

    return {
      lat: currentLat,
      lon: currentLon
    };
  }

  function wgs84ToGcj02(lat, lon) {
    var a = 6378245.0;
    var ee = 0.00669342162296594323;
    var dLat = transformLat(lon - 105.0, lat - 35.0);
    var dLon = transformLon(lon - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * Math.PI;
    var magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    return {
      lat: lat + dLat,
      lon: lon + dLon
    };
  }

  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y;
    ret += 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }

  function transformLon(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y;
    ret += 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    var radius = 6371000.0;
    var dLat = (lat2 - lat1) * Math.PI / 180.0;
    var dLon = (lon2 - lon1) * Math.PI / 180.0;
    var rLat1 = lat1 * Math.PI / 180.0;
    var rLat2 = lat2 * Math.PI / 180.0;
    var hav = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return radius * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  }

  function outputFitName(inputName) {
    return safeBaseName(inputName).replace(/\.fit$/i, "") + ".wgs84-fixed.fit";
  }

  function safeBaseName(name) {
    return (name || "activity.fit").replace(/[^\w\u4e00-\u9fff .()-]+/g, "_") || "activity.fit";
  }

  function sum(items, mapper) {
    return items.reduce(function (total, item) {
      return total + mapper(item);
    }, 0);
  }

  function roundNumber(value, digits) {
    if (!Number.isFinite(value)) return 0;
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  window.MageneFitMobile = {
    patchFitCoordinates: patchFitCoordinates,
    fitCrc: fitCrc,
    gcj02ToWgs84Exact: gcj02ToWgs84Exact
  };
}());
