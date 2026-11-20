using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Only the parent-owned pipes carry controls/results; remote page console output is never forwarded.
namespace Folia.AppleMusic
{
    internal sealed class JsonLineProtocol
    {
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024, RecursionLimit = 100 };
        private readonly StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        private readonly object gate = new object();
        internal string Encode(object value) { lock (gate) return json.Serialize(value); }
        internal Dictionary<string, object> Decode(string value) { lock (gate) return json.Deserialize<Dictionary<string, object>>(value); }
        internal void Send(object value) { lock (gate) output.WriteLine(json.Serialize(value)); }
        internal void Reply(string id, object data = null, string error = null)
        {
            var result = new Dictionary<string, object> { ["id"] = id, ["ok"] = error == null };
            if (error == null) result["data"] = data; else result["error"] = error;
            Send(result);
        }
        internal void Read(Action<Dictionary<string, object>> receive, Action eof)
        {
            try
            {
                using (var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), false, 4096))
                {
                    var line = new StringBuilder();
                    var block = new char[4096];
                    int count;
                    while ((count = input.Read(block, 0, block.Length)) > 0)
                    {
                        for (var index = 0; index < count; index++)
                        {
                            if (block[index] == '\n')
                            {
                                try { receive(Decode(line.ToString())); } catch (ArgumentException) { }
                                catch (InvalidOperationException) { }
                                line.Clear();
                            }
                            else
                            {
                                line.Append(block[index]);
                                if (line.Length > 128 * 1024) return;
                            }
                        }
                    }
                }
            }
            catch (IOException) { }
            finally { eof(); }
        }
        internal static string Text(Dictionary<string, object> value, string key) => value != null && value.TryGetValue(key, out var raw) ? raw as string : null;
    }
}
